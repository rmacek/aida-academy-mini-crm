import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../lib/passwords.ts", import.meta.url), "utf8");

function section(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing source section start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing source section end: ${endNeedle}`);
  return source.slice(start, end);
}

function assertOrdered(text, needles) {
  let cursor = 0;
  for (const needle of needles) {
    const index = text.indexOf(needle, cursor);
    assert.notEqual(index, -1, `Missing or out-of-order source contract: ${needle}`);
    cursor = index + needle.length;
  }
}

const derivePassword = section("function derivePassword", "function hasBoundedPasswordEncoding");
const boundedPassword = section("function hasBoundedPasswordEncoding", "function decodeCanonicalBase64");
const decodeBase64 = section("function decodeCanonicalBase64", "export async function hashPassword");
const hashPassword = section("export async function hashPassword", "export async function verifyPassword");
const verifyPassword = section("export async function verifyPassword", "export function requireStrongPassword");
const strongPassword = source.slice(source.indexOf("export function requireStrongPassword"));

test("uses the exact versioned scrypt format and reviewed parameters", () => {
  assert.match(source, /^const SCRYPT_N = 32768;$/m);
  assert.match(source, /^const SCRYPT_R = 8;$/m);
  assert.match(source, /^const SCRYPT_P = 1;$/m);
  assert.match(source, /^const SCRYPT_MAXMEM = 67108864;$/m);
  assert.match(source, /^const SALT_BYTES = 16;$/m);
  assert.match(source, /^const DIGEST_BYTES = 64;$/m);
  assertOrdered(derivePassword, [
    "scryptCallback(",
    "password,",
    "salt,",
    "DIGEST_BYTES,",
    "{ N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },",
  ]);
  assertOrdered(hashPassword, [
    "const salt = randomBytes(SALT_BYTES);",
    "const derived = await derivePassword(password, salt);",
    "return `scrypt$v=1$N=32768$r=8$p=1$maxmem=67108864$${salt.toString(\"base64\")}$${derived.toString(\"base64\")}`;",
  ]);
});

test("bounds password and record inputs before scrypt work", () => {
  assert.match(source, /^const MAX_PASSWORD_CHARACTERS = 256;$/m);
  assert.match(source, /^const MAX_PASSWORD_UTF8_BYTES = 768;$/m);
  assert.match(source, /^const MAX_RECORD_CHARACTERS = 256;$/m);
  assert.match(source, /^const MAX_RECORD_UTF8_BYTES = 256;$/m);
  assertOrdered(boundedPassword, [
    "typeof value === \"string\"",
    "value.length > 0",
    "value.length <= MAX_PASSWORD_CHARACTERS",
    "Buffer.byteLength(value, \"utf8\") <= MAX_PASSWORD_UTF8_BYTES",
  ]);
  assertOrdered(hashPassword, [
    "requireStrongPassword(password);",
    "if (!hasBoundedPasswordEncoding(password)) {",
    "const salt = randomBytes(SALT_BYTES);",
    "const derived = await derivePassword(password, salt);",
  ]);
  assertOrdered(verifyPassword, [
    "if (!hasBoundedPasswordEncoding(password)",
    "|| typeof stored !== \"string\"",
    "|| stored.length > MAX_RECORD_CHARACTERS",
    "|| Buffer.byteLength(stored, \"utf8\") > MAX_RECORD_UTF8_BYTES)",
    "const fields = stored.split(\"$\");",
    "const actual = await derivePassword(password, salt);",
  ]);
  assertOrdered(strongPassword, [
    "password.length < 16 || password.length > 256",
    "!/[a-z]/.test(password)",
    "!/[A-Z0-9]/.test(password)",
    "!/[^A-Za-z0-9]/.test(password)",
  ]);
});

test("requires canonical Base64 with fixed salt and digest lengths", () => {
  assert.ok(source.includes("const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;"));
  assertOrdered(decodeBase64, [
    "const expectedCharacters = Math.ceil(expectedBytes / 3) * 4;",
    "if (value.length !== expectedCharacters || !BASE64_PATTERN.test(value)) return null;",
    "const decoded = Buffer.from(value, \"base64\");",
    "if (decoded.length !== expectedBytes || decoded.toString(\"base64\") !== value) return null;",
    "return decoded;",
  ]);
  assertOrdered(verifyPassword, [
    "const salt = decodeCanonicalBase64(fields[6], SALT_BYTES);",
    "const expected = decodeCanonicalBase64(fields[7], DIGEST_BYTES);",
    "if (!salt || !expected) return false;",
  ]);
});

test("parses only the exact allowlisted record and fails closed on malformed values", () => {
  assertOrdered(verifyPassword, [
    "if (fields.length !== 8",
    "|| fields[0] !== \"scrypt\"",
    "|| fields[1] !== \"v=1\"",
    "|| fields[2] !== \"N=32768\"",
    "|| fields[3] !== \"r=8\"",
    "|| fields[4] !== \"p=1\"",
    "|| fields[5] !== \"maxmem=67108864\")",
    "return false;",
    "const salt = decodeCanonicalBase64(fields[6], SALT_BYTES);",
  ]);
  assertOrdered(verifyPassword, [
    "try {",
    "const actual = await derivePassword(password, salt);",
    "actual.length === DIGEST_BYTES",
    "expected.length === DIGEST_BYTES",
    "timingSafeEqual(actual, expected);",
    "} catch {",
    "return false;",
  ]);
});

test("contains no embedded installation-password credential literal", () => {
  assert.doesNotMatch(source, /\b(?:password|passwort)\w*\s*=\s*["'`][^"'`\n]+["'`]/i);
  assert.doesNotMatch(source, /\b(?:hashPassword|verifyPassword|requireStrongPassword)\(\s*["'`]/);
  assert.doesNotMatch(source, /CRM_BOOTSTRAP_ADMIN_PASSWORD\s*[:=]\s*["'`]/);
});
