import { currentApiUser, unauthorized } from "../../api-user";
import { ownsOpportunity, runtimeEnv } from "../../../db/repository";

type ActionRequest = {
  action?: string;
  opportunityId?: string;
  activityId?: string;
  conversationId?: string;
  title?: string;
  body?: string;
};

export async function POST(request: Request) {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const input = await request.json<ActionRequest>();
  const opportunityId = safeId(input.opportunityId);
  if (!opportunityId || !(await ownsOpportunity(user.userId, opportunityId))) {
    return Response.json({ error: "opportunity_not_found" }, { status: 404 });
  }

  const db = runtimeEnv().DB;
  const now = new Date().toISOString();
  if (input.action === "toggle-todo") {
    const activityId = safeId(input.activityId);
    if (!activityId) return invalid("activityId");
    await db.prepare(`UPDATE activities
      SET status = CASE status WHEN 'done' THEN 'open' ELSE 'done' END
      WHERE id = ? AND opportunity_id = ? AND owner_id = ? AND type = 'todo'`)
      .bind(activityId, opportunityId, user.userId).run();
  } else if (input.action === "add-note") {
    const body = safeText(input.body, 2, 2000);
    if (!body) return invalid("body");
    await db.prepare(`INSERT INTO activities
      (id, opportunity_id, owner_id, type, title, due_at, status, body, created_at)
      VALUES (?, ?, ?, 'note', ?, ?, 'recorded', ?, ?)`)
      .bind(crypto.randomUUID(), opportunityId, user.userId,
        body.length > 72 ? `${body.slice(0, 69)}…` : body,
        now, body, now).run();
  } else if (input.action === "new-chat") {
    const title = safeText(input.title, 2, 100) ?? "Neue Unterhaltung";
    await db.prepare(`INSERT INTO conversations
      (id, opportunity_id, owner_id, title, aida_conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)`)
      .bind(crypto.randomUUID(), opportunityId, user.userId, title, now, now).run();
  } else {
    return invalid("action");
  }

  return Response.json({ ok: true });
}

function safeId(value: string | undefined) {
  return value && /^[a-zA-Z0-9-]{2,80}$/.test(value) ? value : null;
}

function safeText(value: string | undefined, min: number, max: number) {
  const normalized = value?.trim() ?? "";
  return normalized.length >= min && normalized.length <= max
    && ![...normalized].some(character => character < " " && !"\n\r\t".includes(character))
    ? normalized
    : null;
}

function invalid(field: string) {
  return Response.json({ error: "validation_failed", field }, { status: 400 });
}
