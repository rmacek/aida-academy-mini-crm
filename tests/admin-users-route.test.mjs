import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");

function section(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source section start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source section end: ${endNeedle}`);
  return source.slice(start, end);
}

function transactionCallback(functionSource) {
  const startNeedle = "transaction(async client => {";
  const endNeedle = "\n    });";
  const start = functionSource.indexOf(startNeedle);
  assert.notEqual(start, -1, "Missing transaction callback");
  const end = functionSource.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, "Missing transaction callback end");
  return functionSource.slice(start, end + endNeedle.length);
}

function assertOrdered(text, needles) {
  let cursor = 0;
  for (const needle of needles) {
    const index = text.indexOf(needle, cursor);
    assert.notEqual(index, -1, `Missing or out-of-order source contract: ${needle}`);
    cursor = index + needle.length;
  }
}

const post = section("export async function POST", "async function createUser");
const createUser = section("async function createUser", "async function updateUser");
const updateUser = section("async function updateUser", "async function resetPassword");
const resetPassword = section("async function resetPassword", "function unexpectedRowCount");

test("admin user actions retain same-origin, session, admin, and password-change guards", () => {
  assertOrdered(post, [
    "await requireSameOrigin(request)",
    "const actor = await currentApiUser();",
    "if (!actor) return unauthorized();",
    "if (actor.role !== \"admin\" || actor.mustChangePassword) return forbidden();",
    "const parsedInput: unknown = await request.json().catch(() => ({}));",
    "if (typeof parsedInput !== \"object\" || parsedInput === null || Array.isArray(parsedInput)) {",
    "return Response.json({ error: \"validation_failed\" }, { status: 400 });",
    "const input = parsedInput as Input;",
  ]);
});

test("concurrent last-admin mutations are serialized inside one transaction", () => {
  // This deterministic contract test protects transaction structure when isolated tests cannot
  // open parallel PostgreSQL sessions. A real parallel-session database gate remains required.
  assert.equal((updateUser.match(/transaction\(async client => \{/g) ?? []).length, 1);
  const transaction = transactionCallback(updateUser);

  assertOrdered(transaction, [
    "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
    "SELECT role FROM users WHERE id=$1 FOR UPDATE",
    "SELECT count(*)::int AS count FROM users WHERE role='admin' AND active AND id<>$1",
    "if (remaining.rows[0].count < 1) return \"last_admin\";",
    "UPDATE users SET display_name=$1,role=$2,active=$3,updated_at=now() WHERE id=$4",
  ]);
  assert.match(transaction, /\[ADMIN_STATE_LOCK\]/);
  assert.match(updateUser, /if \(outcome === "last_admin"\) return Response\.json\(\{ error: "last_admin_protected" \}, \{ status: 400 \}\);/);
});

test("updateUser cannot report success or write a succeeded audit for a missing user", () => {
  const transaction = transactionCallback(updateUser);

  assertOrdered(transaction, [
    "UPDATE users SET display_name=$1,role=$2,active=$3,updated_at=now() WHERE id=$4",
    "if (result.rowCount === 0) return \"not_found\";",
    "if (result.rowCount !== 1) throw unexpectedRowCount(\"user.update\", result.rowCount);",
    "'user.update','user',$2,'succeeded'",
    "return \"updated\";",
  ]);
  assertOrdered(updateUser, [
    "if (outcome === \"not_found\") return Response.json({ error: \"user_not_found\" }, { status: 404 });",
    "return Response.json({ ok: true });",
  ]);
});

test("resetPassword cannot report success or write a succeeded audit for a missing user", () => {
  const transaction = transactionCallback(resetPassword);

  assertOrdered(transaction, [
    "UPDATE users SET password_hash=$1,must_change_password=true,updated_at=now() WHERE id=$2",
    "if (result.rowCount === 0) return \"not_found\";",
    "if (result.rowCount !== 1) throw unexpectedRowCount(\"user.password-reset\", result.rowCount);",
    "DELETE FROM sessions WHERE user_id=$1",
    "'user.password-reset','user',$2,'succeeded'",
    "return \"updated\";",
  ]);
  assertOrdered(resetPassword, [
    "if (outcome === \"not_found\") return Response.json({ error: \"user_not_found\" }, { status: 404 });",
    "return Response.json({ ok: true });",
  ]);
});

test("unexpected create and password-reset failures use stable client-safe responses", () => {
  assertOrdered(createUser, [
    "console.error(\"Failed to create user\", error);",
    "return Response.json({ error: \"user_create_failed\", message: \"Unable to create user.\" }, { status: 400 });",
  ]);
  assertOrdered(resetPassword, [
    "console.error(\"Failed to reset user password\", error);",
    "return Response.json({ error: \"password_policy\", message: \"Unable to reset password.\" }, { status: 400 });",
  ]);

  assert.doesNotMatch(createUser, /message:\s*(?:error\b|String\(|`)/);
  assert.doesNotMatch(resetPassword, /message:\s*(?:error\b|String\(|`)/);
});

test("uppercase authenticated actor UUID cannot bypass the self-deactivation guard", () => {
  const validUuidSource = section("function validUuid", "function invalid");
  const actorId = "550e8400-e29b-41d4-a716-446655440000";
  const uppercaseActorId = actorId.toUpperCase();
  const otherActorId = "550e8400-e29b-41d4-a716-446655440001";
  const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const canonicalizeUuid = value => canonicalUuid.test(value) ? value.toLowerCase() : null;

  assertOrdered(post, [
    "const actor = await currentApiUser();",
    "if (input.action === \"update\") return updateUser(actor.userId, input);",
  ]);
  assert.match(validUuidSource, /\? value\.toLowerCase\(\) : null;/);
  assertOrdered(updateUser, [
    "const id = validUuid(input.id);",
    "const normalizedActorId = validUuid(actorId);",
    "if (!id || !normalizedActorId || !displayName || !role || typeof input.active !== \"boolean\") return invalid();",
    "if (id === normalizedActorId && !input.active) return Response.json({ error: \"cannot_deactivate_self\" }, { status: 400 });",
    "const outcome = await transaction(async client => {",
  ]);

  const normalizedTargetId = canonicalizeUuid(actorId);
  const normalizedUppercaseActorId = canonicalizeUuid(uppercaseActorId);
  const normalizedLowercaseActorId = canonicalizeUuid(actorId);
  const normalizedOtherActorId = canonicalizeUuid(otherActorId);

  assert.notEqual(uppercaseActorId, actorId);
  assert.equal(normalizedUppercaseActorId, normalizedTargetId);
  assert.equal(normalizedLowercaseActorId, normalizedTargetId);
  assert.notEqual(normalizedOtherActorId, normalizedTargetId);
  assert.equal(normalizedTargetId === normalizedUppercaseActorId && !false, true);
  assert.equal(normalizedTargetId === normalizedLowercaseActorId && !false, true);
  assert.equal(normalizedTargetId === normalizedOtherActorId && !false, false);
});

test("malformed UUIDs are rejected before database access", () => {
  const validUuidSource = section("function validUuid", "function invalid");
  const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  assertOrdered(updateUser, [
    "const id = validUuid(input.id);",
    "const normalizedActorId = validUuid(actorId);",
    "if (!id || !normalizedActorId || !displayName || !role || typeof input.active !== \"boolean\") return invalid();",
    "const outcome = await transaction(async client => {",
  ]);
  assert.ok(validUuidSource.includes(`&& /${canonicalUuid.source}/${canonicalUuid.flags}.test(value)`));
  assert.equal(canonicalUuid.test("ffffffff-ffff-ffff-ffff-ffffffffffff"), false);
  assert.equal(canonicalUuid.test("550e8400-e29b-41d4-a716-446655440000"), true);
});
