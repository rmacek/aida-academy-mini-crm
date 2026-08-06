import { currentApiUser, forbidden, requireSameOrigin, unauthorized } from "../../../api-user";
import { query, transaction } from "../../../../db";
import type { CrmRole } from "../../../../db/repository";
import { hashPassword } from "../../../../lib/passwords";

type Input = { action?: string; id?: string; username?: string; displayName?: string; role?: CrmRole; password?: string; active?: boolean };

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const actor = await currentApiUser();
  if (!actor) return unauthorized();
  if (actor.role !== "admin" || actor.mustChangePassword) return forbidden();
  const input = await request.json().catch(() => ({})) as Input;
  if (input.action === "create") return createUser(actor.userId, input);
  if (input.action === "update") return updateUser(actor.userId, input);
  if (input.action === "reset-password") return resetPassword(actor.userId, input);
  return Response.json({ error: "validation_failed" }, { status: 400 });
}

async function createUser(actorId: string, input: Input) {
  const username = validUsername(input.username);
  const displayName = validText(input.displayName, 2, 160);
  const role = validRole(input.role);
  if (!username || !displayName || !role || !input.password) return invalid();
  try {
    const id = crypto.randomUUID();
    await transaction(async client => {
      await client.query(
        `INSERT INTO users(id,username,display_name,password_hash,role,must_change_password)
         VALUES ($1,$2,$3,$4,$5,true)`, [id, username, displayName, await hashPassword(input.password!), role]);
      await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
        VALUES ($1,'user.create','user',$2,'succeeded')`, [actorId, id]);
    });
    return Response.json({ ok: true, id });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return code === "23505" ? Response.json({ error: "username_exists" }, { status: 409 })
      : Response.json({ error: "user_create_failed", message: error instanceof Error ? error.message : undefined }, { status: 400 });
  }
}

async function updateUser(actorId: string, input: Input) {
  const id = validUuid(input.id);
  const displayName = validText(input.displayName, 2, 160);
  const role = validRole(input.role);
  if (!id || !displayName || !role || typeof input.active !== "boolean") return invalid();
  if (id === actorId && !input.active) return Response.json({ error: "cannot_deactivate_self" }, { status: 400 });
  if (!input.active || role !== "admin") {
    const remaining = await query<{ count: number }>(
      "SELECT count(*)::int AS count FROM users WHERE role='admin' AND active AND id<>$1", [id]);
    const target = await query<{ role: CrmRole }>("SELECT role FROM users WHERE id=$1", [id]);
    if (target.rows[0]?.role === "admin" && remaining.rows[0].count < 1) {
      return Response.json({ error: "last_admin_protected" }, { status: 400 });
    }
  }
  await transaction(async client => {
    await client.query(`UPDATE users SET display_name=$1,role=$2,active=$3,updated_at=now() WHERE id=$4`,
      [displayName, role, input.active, id]);
    if (!input.active) await client.query("DELETE FROM sessions WHERE user_id=$1", [id]);
    await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
      VALUES ($1,'user.update','user',$2,'succeeded')`, [actorId, id]);
  });
  return Response.json({ ok: true });
}

async function resetPassword(actorId: string, input: Input) {
  const id = validUuid(input.id);
  if (!id || !input.password) return invalid();
  try {
    await transaction(async client => {
      await client.query(`UPDATE users SET password_hash=$1,must_change_password=true,updated_at=now() WHERE id=$2`,
        [await hashPassword(input.password!), id]);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
        VALUES ($1,'user.password-reset','user',$2,'succeeded')`, [actorId, id]);
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: "password_policy", message: error instanceof Error ? error.message : undefined }, { status: 400 });
  }
}

function validUsername(value: unknown) { const text = typeof value === "string" ? value.trim().toLowerCase() : ""; return /^[a-z][a-z0-9._-]{2,79}$/.test(text) ? text : null; }
function validText(value: unknown, min: number, max: number) { const text = typeof value === "string" ? value.trim() : ""; return text.length >= min && text.length <= max ? text : null; }
function validRole(value: unknown): CrmRole | null { return value === "admin" || value === "sales" || value === "reader" ? value : null; }
function validUuid(value: unknown) { return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null; }
function invalid() { return Response.json({ error: "validation_failed" }, { status: 400 }); }
