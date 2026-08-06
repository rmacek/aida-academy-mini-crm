import { currentApiUser, forbidden, requireSameOrigin, unauthorized } from "../../api-user";
import { query, transaction } from "../../../db";
import { canAccessOpportunity, canWrite } from "../../../db/repository";

type ActionRequest = Record<string, unknown> & { action?: string; opportunityId?: string };
const stages = new Set(["Qualifizierung", "Lösungsdesign", "Angebot", "Verhandlung", "Gewonnen", "Verloren"]);

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const user = await currentApiUser();
  if (!user) return unauthorized();
  if (!canWrite(user) || user.mustChangePassword) return forbidden();
  const input = await request.json().catch(() => ({})) as ActionRequest;

  if (input.action === "create-opportunity") return createOpportunity(user.userId, input);
  const opportunityId = safeUuid(input.opportunityId);
  if (!opportunityId || !(await canAccessOpportunity(opportunityId))) {
    return Response.json({ error: "opportunity_not_found" }, { status: 404 });
  }

  if (input.action === "update-opportunity") return updateOpportunity(user.userId, opportunityId, input);
  if (input.action === "delete-opportunity") return deleteOpportunity(user.userId, opportunityId, input);
  if (input.action === "toggle-todo") return toggleTodo(user.userId, opportunityId, input);
  if (input.action === "create-activity") return createActivity(user.userId, opportunityId, input);
  if (input.action === "update-activity") return updateActivity(user.userId, opportunityId, input);
  if (input.action === "delete-activity") return deleteActivity(user.userId, opportunityId, input);
  if (input.action === "add-note") {
    input.type = "note";
    input.title = titleFromBody(text(input.body, 2, 2000) ?? "Notiz");
    input.dueAt = new Date().toISOString();
    return createActivity(user.userId, opportunityId, input);
  }
  if (input.action === "new-chat") return createConversation(user.userId, opportunityId, input);
  return invalid("action");
}

async function createOpportunity(userId: string, input: ActionRequest) {
  const values = opportunityValues(input);
  if (!values) return invalid("opportunity");
  const id = crypto.randomUUID();
  try {
    await transaction(async client => {
      await client.query(
        `INSERT INTO opportunities
          (id, code, name, customer, value_eur, stage, probability, close_date,
           summary, use_case, accent, context_marker, owner_user_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [id, values.code, values.name, values.customer, values.value, values.stage,
          values.probability, values.closeDate, values.summary, values.useCase, values.accent,
          `CTX-${crypto.randomUUID()}`, userId],
      );
      await client.query(
        `INSERT INTO conversations(id, opportunity_id, title, created_by)
         VALUES ($1,$2,'Erste Analyse',$3)`, [crypto.randomUUID(), id, userId]);
      await audit(client, userId, "opportunity.create", "opportunity", id);
    });
    return Response.json({ ok: true, id });
  } catch (error) {
    return databaseError(error, "Eine Verkaufschance mit diesem Code existiert bereits.");
  }
}

async function updateOpportunity(userId: string, opportunityId: string, input: ActionRequest) {
  const values = opportunityValues(input);
  if (!values) return invalid("opportunity");
  try {
    await transaction(async client => {
      await client.query(
        `UPDATE opportunities SET code=$1,name=$2,customer=$3,value_eur=$4,stage=$5,
          probability=$6,close_date=$7,summary=$8,use_case=$9,accent=$10,updated_at=now()
         WHERE id=$11`,
        [values.code, values.name, values.customer, values.value, values.stage,
          values.probability, values.closeDate, values.summary, values.useCase, values.accent, opportunityId],
      );
      await audit(client, userId, "opportunity.update", "opportunity", opportunityId);
    });
    return Response.json({ ok: true });
  } catch (error) {
    return databaseError(error, "Eine Verkaufschance mit diesem Code existiert bereits.");
  }
}

async function deleteOpportunity(userId: string, opportunityId: string, input: ActionRequest) {
  const confirmation = text(input.confirmation, 2, 40);
  const current = await query<{ code: string }>("SELECT code FROM opportunities WHERE id=$1", [opportunityId]);
  if (!current.rows[0] || confirmation !== current.rows[0].code) {
    return Response.json({ error: "confirmation_mismatch" }, { status: 400 });
  }
  await transaction(async client => {
    await audit(client, userId, "opportunity.delete", "opportunity", opportunityId);
    await client.query("DELETE FROM opportunities WHERE id=$1", [opportunityId]);
  });
  return Response.json({ ok: true });
}

async function toggleTodo(userId: string, opportunityId: string, input: ActionRequest) {
  const id = safeUuid(input.activityId);
  if (!id) return invalid("activityId");
  await query(
    `UPDATE activities SET status=CASE status WHEN 'done' THEN 'open' ELSE 'done' END, updated_at=now()
     WHERE id=$1 AND opportunity_id=$2 AND type='todo'`, [id, opportunityId]);
  await auditQuery(userId, "activity.toggle", "activity", id);
  return Response.json({ ok: true });
}

async function createActivity(userId: string, opportunityId: string, input: ActionRequest) {
  const type = typeof input.type === "string" && ["appointment", "todo", "note"].includes(input.type)
    ? input.type : null;
  const body = text(input.body, 2, 4000);
  const title = text(input.title, 2, 180);
  const dueAt = dateTime(input.dueAt);
  if (!type || !body || !title || !dueAt) return invalid("activity");
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO activities(id,opportunity_id,type,title,due_at,status,body,assigned_to,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
    [id, opportunityId, type, title, dueAt, type === "note" ? "recorded" : "open", body, userId]);
  await auditQuery(userId, "activity.create", "activity", id);
  return Response.json({ ok: true, id });
}

async function updateActivity(userId: string, opportunityId: string, input: ActionRequest) {
  const id = safeUuid(input.activityId);
  const type = typeof input.type === "string" && ["appointment", "todo", "note"].includes(input.type)
    ? input.type : null;
  const body = text(input.body, 2, 4000);
  const title = text(input.title, 2, 180);
  const dueAt = dateTime(input.dueAt);
  if (!id || !type || !body || !title || !dueAt) return invalid("activity");
  const result = await query(
    `UPDATE activities SET type=$1::varchar,title=$2,due_at=$3,body=$4,
       status=CASE WHEN $1::varchar='note' THEN 'recorded' WHEN type='note' THEN 'open' ELSE status END,
       updated_at=now()
     WHERE id=$5 AND opportunity_id=$6`,
    [type, title, dueAt, body, id, opportunityId],
  );
  if (!result.rowCount) return Response.json({ error: "activity_not_found" }, { status: 404 });
  await auditQuery(userId, "activity.update", "activity", id);
  return Response.json({ ok: true });
}

async function deleteActivity(userId: string, opportunityId: string, input: ActionRequest) {
  const id = safeUuid(input.activityId);
  if (!id) return invalid("activityId");
  await query("DELETE FROM activities WHERE id=$1 AND opportunity_id=$2", [id, opportunityId]);
  await auditQuery(userId, "activity.delete", "activity", id);
  return Response.json({ ok: true });
}

async function createConversation(userId: string, opportunityId: string, input: ActionRequest) {
  const title = text(input.title, 2, 120) ?? "Neue Unterhaltung";
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO conversations(id,opportunity_id,title,created_by) VALUES ($1,$2,$3,$4)`,
    [id, opportunityId, title, userId]);
  await auditQuery(userId, "conversation.create", "conversation", id);
  return Response.json({ ok: true, id });
}

function opportunityValues(input: ActionRequest) {
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const name = text(input.name, 2, 180);
  const customer = text(input.customer, 2, 180);
  const summary = text(input.summary, 2, 2000);
  const useCase = text(input.useCase, 10, 8000);
  const stage = typeof input.stage === "string" && stages.has(input.stage) ? input.stage : null;
  const accent = typeof input.accent === "string" && ["violet", "teal", "orange", "blue"].includes(input.accent)
    ? input.accent : "violet";
  const value = integer(input.value, 0, 9_000_000_000);
  const probability = integer(input.probability, 0, 100);
  const closeDate = dateOnly(input.closeDate);
  return /^[A-Z0-9][A-Z0-9._-]{2,39}$/.test(code) && name && customer && summary && useCase
    && stage && value !== null && probability !== null && closeDate
    ? { code, name, customer, summary, useCase, stage, accent, value, probability, closeDate }
    : null;
}

function safeUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}
function text(value: unknown, min: number, max: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length >= min && normalized.length <= max
    && ![...normalized].some(character => character < " " && !"\n\r\t".includes(character))
    ? normalized : null;
}
function integer(value: unknown, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}
function dateOnly(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null;
}
function dateTime(value: unknown) {
  const parsed = typeof value === "string" ? new Date(value) : new Date(NaN);
  return !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : null;
}
function titleFromBody(value: string) { return value.length > 72 ? `${value.slice(0, 69)}…` : value; }
function invalid(field: string) { return Response.json({ error: "validation_failed", field }, { status: 400 }); }
function databaseError(error: unknown, message: string) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  return code === "23505" ? Response.json({ error: "duplicate", message }, { status: 409 })
    : Response.json({ error: "write_failed" }, { status: 500 });
}
async function auditQuery(userId: string, action: string, entityType: string, entityId: string | null) {
  await query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
    VALUES ($1,$2,$3,$4,'succeeded')`, [userId, action, entityType, entityId]);
}
async function audit(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, userId: string,
  action: string, entityType: string, entityId: string | null) {
  await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
    VALUES ($1,$2,$3,$4,'succeeded')`, [userId, action, entityType, entityId]);
}
