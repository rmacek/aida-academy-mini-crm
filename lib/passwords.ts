import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 67108864;
const SALT_BYTES = 16;
const DIGEST_BYTES = 64;
const MAX_PASSWORD_CHARACTERS = 256;
const MAX_PASSWORD_UTF8_BYTES = 768;
const MAX_RECORD_CHARACTERS = 256;
const MAX_RECORD_UTF8_BYTES = 256;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      DIGEST_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function hasBoundedPasswordEncoding(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_PASSWORD_CHARACTERS
    && Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_UTF8_BYTES;
}

function decodeCanonicalBase64(value: string, expectedBytes: number) {
  const expectedCharacters = Math.ceil(expectedBytes / 3) * 4;
  if (value.length !== expectedCharacters || !BASE64_PATTERN.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== value) return null;
  return decoded;
}

export async function hashPassword(password: string) {
  requireStrongPassword(password);
  if (!hasBoundedPasswordEncoding(password)) {
    throw new Error("Das Passwort muss 16 bis 256 Zeichen, einen Kleinbuchstaben, eine Ziffer oder einen Großbuchstaben und ein Sonderzeichen enthalten.");
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = await derivePassword(password, salt);
  return `scrypt$v=1$N=32768$r=8$p=1$maxmem=67108864$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  if (!hasBoundedPasswordEncoding(password)
      || typeof stored !== "string"
      || stored.length > MAX_RECORD_CHARACTERS
      || Buffer.byteLength(stored, "utf8") > MAX_RECORD_UTF8_BYTES) {
    return false;
  }

  const fields = stored.split("$");
  if (fields.length !== 8
      || fields[0] !== "scrypt"
      || fields[1] !== "v=1"
      || fields[2] !== "N=32768"
      || fields[3] !== "r=8"
      || fields[4] !== "p=1"
      || fields[5] !== "maxmem=67108864") {
    return false;
  }

  const salt = decodeCanonicalBase64(fields[6], SALT_BYTES);
  const expected = decodeCanonicalBase64(fields[7], DIGEST_BYTES);
  if (!salt || !expected) return false;

  try {
    const actual = await derivePassword(password, salt);
    return actual.length === DIGEST_BYTES
      && expected.length === DIGEST_BYTES
      && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function requireStrongPassword(password: string) {
  if (password.length < 16 || password.length > 256
      || !/[a-z]/.test(password) || !/[A-Z0-9]/.test(password)
      || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("Das Passwort muss 16 bis 256 Zeichen, einen Kleinbuchstaben, eine Ziffer oder einen Großbuchstaben und ein Sonderzeichen enthalten.");
  }
}
