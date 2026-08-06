import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { query } from "../db/index";
import type { CrmRole, CrmUser } from "../db/repository";
import { hashPassword, requireStrongPassword, verifyPassword } from "../lib/passwords";

const sessionCookie = "aida_crm_session";
const sessionSeconds = 8 * 60 * 60;

type UserRow = {
  userId: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: CrmRole;
  mustChangePassword: boolean;
  active: boolean;
};

export async function currentApiUser(): Promise<CrmUser | null> {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const result = await query<UserRow>(
    `SELECT u.id AS "userId", u.username, u.display_name AS "displayName",
      u.password_hash AS "passwordHash", u.role, u.must_change_password AS "mustChangePassword",
      u.active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true`,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  void query("UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1", [tokenHash(token)]);
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
    mode: "database",
  };
}

export async function login(username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  const attemptKey = await authenticationKey(normalized);
  const blocked = await query<{ blockedUntil: Date | null }>(
    `SELECT blocked_until AS "blockedUntil" FROM auth_failures
     WHERE key_hash = $1 AND blocked_until > now()`, [attemptKey]);
  if (blocked.rowCount) return { ok: false as const, code: "temporarily_blocked" };

  const result = await query<UserRow>(
    `SELECT id AS "userId", username, display_name AS "displayName",
      password_hash AS "passwordHash", role, must_change_password AS "mustChangePassword", active
     FROM users WHERE lower(username) = lower($1)`, [normalized]);
  const row = result.rows[0];
  if (!row?.active || !(await verifyPassword(password, row.passwordHash))) {
    await recordFailure(attemptKey);
    return { ok: false as const, code: "invalid_credentials" };
  }

  await query("DELETE FROM auth_failures WHERE key_hash = $1", [attemptKey]);
  const token = randomBytes(48).toString("base64url");
  await query(
    `INSERT INTO sessions(token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [tokenHash(token), row.userId, String(sessionSeconds)],
  );
  await query(
    `INSERT INTO audit_log(actor_user_id, action, entity_type, entity_id, outcome)
     VALUES ($1, 'auth.login', 'user', $2, 'succeeded')`, [row.userId, row.userId]);
  return { ok: true as const, token, mustChangePassword: row.mustChangePassword };
}

export async function logout() {
  const store = await cookies();
  const token = store.get(sessionCookie)?.value;
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  store.set(sessionCookie, "", cookieOptions(0));
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(sessionCookie, token, cookieOptions(sessionSeconds));
}

export async function changeOwnPassword(user: CrmUser, currentPassword: string, nextPassword: string) {
  requireStrongPassword(nextPassword);
  const result = await query<{ passwordHash: string }>(
    `SELECT password_hash AS "passwordHash" FROM users WHERE id = $1 AND active`, [user.userId]);
  if (!result.rows[0] || !(await verifyPassword(currentPassword, result.rows[0].passwordHash))) {
    return false;
  }
  await query(
    `UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2`,
    [await hashPassword(nextPassword), user.userId],
  );
  await query("DELETE FROM sessions WHERE user_id = $1", [user.userId]);
  return true;
}

export async function requireSameOrigin(request: Request) {
  const originText = request.headers.get("origin");
  if (!originText) return false;
  let origin: URL;
  try {
    origin = new URL(originText);
  } catch {
    return false;
  }

  const configuredOrigin = process.env.CRM_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      if (origin.origin !== new URL(configuredOrigin).origin) return false;
    } catch {
      return false;
    }
  } else {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const requestHost = request.headers.get("host")?.trim();
    const internalHost = new URL(request.url).host;
    const acceptedHosts = new Set([forwardedHost, requestHost, internalHost].filter(Boolean));
    if (!acceptedHosts.has(origin.host)) return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

export function unauthorized() {
  return Response.json(
    { error: "authentication_required", message: "Bitte melden Sie sich an." },
    { status: 401 },
  );
}

export function forbidden() {
  return Response.json(
    { error: "permission_denied", message: "Ihre Rolle erlaubt diese Änderung nicht." },
    { status: 403 },
  );
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function authenticationKey(username: string) {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`${forwarded}|${username}`).digest("hex");
}

async function recordFailure(key: string) {
  await query(
    `INSERT INTO auth_failures(key_hash, failure_count, window_started_at, blocked_until)
     VALUES ($1, 1, now(), NULL)
     ON CONFLICT (key_hash) DO UPDATE SET
       failure_count = CASE WHEN auth_failures.window_started_at < now() - interval '15 minutes'
         THEN 1 ELSE auth_failures.failure_count + 1 END,
       window_started_at = CASE WHEN auth_failures.window_started_at < now() - interval '15 minutes'
         THEN now() ELSE auth_failures.window_started_at END,
       blocked_until = CASE WHEN
         (CASE WHEN auth_failures.window_started_at < now() - interval '15 minutes'
           THEN 1 ELSE auth_failures.failure_count + 1 END) >= 5
         THEN now() + interval '15 minutes' ELSE auth_failures.blocked_until END`,
    [key],
  );
}
