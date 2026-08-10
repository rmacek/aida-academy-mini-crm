import { currentApiUser, forbidden, requireSameOrigin, unauthorized } from "../../../api-user";
import { transaction } from "../../../../db";
import type { CrmRole } from "../../../../db/repository";
import { hashPassword } from "../../../../lib/passwords";

type Input = { action?: string; id?: string; username?: string; displayName?: string; role?: CrmRole; password?: string; active?: boolean };

const ADMIN_STATE_LOCK = "admin-users-active-admin";

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const actor = await currentApiUser();
  if (!actor) return unauthorized();
  if (actor.role !== "admin" || actor.mustChangePassword) return forbidden();
  const parsedInput: unknown = await request.json().catch(() => ({}));
  if (typeof parsedInput !== "object" || parsedInput === null || Array.isArray(parsedInput)) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
  const input = parsedInput as Input;
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
    const passwordHash = await hashPassword(input.password);
    await transaction(async client => {
      if (role === "admin") {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [ADMIN_STATE_LOCK]);
      }
      const result = await client.query(
        `INSERT INTO users(id,username,display_name,password_hash,role,must_change_password)
         VALUES ($1,$2,$3,$4,$5,true)`, [id, username, displayName, passwordHash, role]);
      if (result.rowCount !== 1) throw unexpectedRowCount("user.create", result.rowCount);
      await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
        VALUES ($1,'user.create','user',$2,'succeeded')`, [actorId, id]);
    });
    return Response.json({ ok: true, id });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "23505") return Response.json({ error: "username_exists" }, { status: 409 });
    console.error("Failed to create user", error);
    return Response.json({ error: "user_create_failed", message: "Unable to create user." }, { status: 400 });
  }
}

async function updateUser(actorId: string, input: Input) {
  const id = validUuid(input.id);
  const normalizedActorId = validUuid(actorId);
  const displayName = validText(input.displayName, 2, 160);
  const role = validRole(input.role);
  if (!id || !normalizedActorId || !displayName || !role || typeof input.active !== "boolean") return invalid();
  if (id === normalizedActorId && !input.active) return Response.json({ error: "cannot_deactivate_self" }, { status: 400 });
  try {
    const outcome = await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [ADMIN_STATE_LOCK]);
      const target = await client.query<{ role: CrmRole }>(
        "SELECT role FROM users WHERE id=$1 FOR UPDATE", [id]);
      if (!target.rows[0]) return "not_found";
      if ((!input.active || role !== "admin") && target.rows[0].role === "admin") {
        const remaining = await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM users WHERE role='admin' AND active AND id<>$1", [id]);
        if (remaining.rows[0].count < 1) return "last_admin";
      }
      const result = await client.query(`UPDATE users SET display_name=$1,role=$2,active=$3,updated_at=now() WHERE id=$4`,
        [displayName, role, input.active, id]);
      if (result.rowCount === 0) return "not_found";
      if (result.rowCount !== 1) throw unexpectedRowCount("user.update", result.rowCount);
      if (!input.active) await client.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
        VALUES ($1,'user.update','user',$2,'succeeded')`, [actorId, id]);
      return "updated";
    });
    if (outcome === "not_found") return Response.json({ error: "user_not_found" }, { status: 404 });
    if (outcome === "last_admin") return Response.json({ error: "last_admin_protected" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to update user", error);
    return Response.json({ error: "user_update_failed", message: "Unable to update user." }, { status: 500 });
  }
}

async function resetPassword(actorId: string, input: Input) {
  const id = validUuid(input.id);
  if (!id || !input.password) return invalid();
  try {
    const passwordHash = await hashPassword(input.password);
    const outcome = await transaction(async client => {
      const result = await client.query(`UPDATE users SET password_hash=$1,must_change_password=true,updated_at=now() WHERE id=$2`,
        [passwordHash, id]);
      if (result.rowCount === 0) return "not_found";
      if (result.rowCount !== 1) throw unexpectedRowCount("user.password-reset", result.rowCount);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await client.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
        VALUES ($1,'user.password-reset','user',$2,'succeeded')`, [actorId, id]);
      return "updated";
    });
    if (outcome === "not_found") return Response.json({ error: "user_not_found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to reset user password", error);
    return Response.json({ error: "password_policy", message: "Unable to reset password." }, { status: 400 });
  }
}

function unexpectedRowCount(action: string, rowCount: number | null) {
  return new Error(`${action} affected ${String(rowCount)} rows`);
}

function validUsername(value: unknown) { const text = typeof value === "string" ? value.trim().toLowerCase() : ""; return /^[a-z][a-z0-9._-]{2,79}$/.test(text) ? text : null; }
function validText(value: unknown, min: number, max: number) { const text = typeof value === "string" ? value.trim() : ""; return text.length >= min && text.length <= max ? text : null; }
function validRole(value: unknown): CrmRole | null { return value === "admin" || value === "sales" || value === "reader" ? value : null; }
function validUuid(value: unknown) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null; }
function invalid() { return Response.json({ error: "validation_failed" }, { status: 400 }); }
