import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  requireStrongPassword(password);
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, saltText, hashText] = stored.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64");
  const actual = await scrypt(password, Buffer.from(saltText, "base64"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function requireStrongPassword(password: string) {
  if (password.length < 16 || password.length > 256
      || !/[a-z]/.test(password) || !/[A-Z0-9]/.test(password)
      || !/[^A-Za-z0-9]/.test(password)) {
    throw new Error("Das Passwort muss 16 bis 256 Zeichen, einen Kleinbuchstaben, eine Ziffer oder einen Großbuchstaben und ein Sonderzeichen enthalten.");
  }
}
