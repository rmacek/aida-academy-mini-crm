import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeEnv } from "../db/repository";

export async function saveDocument(file: File) {
  if (file.size < 1 || file.size > 5 * 1024 * 1024 || file.name.length > 180) {
    throw new DocumentValidationError("file_not_allowed");
  }
  const allowed = new Set(["text/plain", "text/markdown", "application/pdf"]);
  if (!allowed.has(file.type)) throw new DocumentValidationError("file_type_not_allowed");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (file.type === "application/pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new DocumentValidationError("file_signature_invalid");
  }
  if (file.type !== "application/pdf" && bytes.includes(0)) {
    throw new DocumentValidationError("text_file_invalid");
  }
  const id = crypto.randomUUID();
  const extension = file.type === "application/pdf" ? ".pdf" : file.type === "text/markdown" ? ".md" : ".txt";
  const storageKey = `${id}${extension}`;
  const destination = containedDocumentPath(storageKey);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  return {
    id,
    name: safeFileName(file.name),
    mediaType: file.type,
    size: bytes.length,
    storageKey,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function readDocument(storageKey: string) {
  return readFile(containedDocumentPath(storageKey));
}

export async function removeStoredDocument(storageKey: string) {
  try { await unlink(containedDocumentPath(storageKey)); } catch { /* DB remains authoritative */ }
}

export async function readTextDocumentContext(storageKey: string, mediaType: string) {
  const bytes = await readDocument(storageKey);
  const text = mediaType === "application/pdf"
    ? await extractPdfText(bytes)
    : bytes.toString("utf8").replace(/\0/g, "").trim();
  return text.slice(0, 20_000);
}

async function extractPdfText(bytes: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText({ first: 20, parseHyperlinks: false });
    return result.text.replace(/\0/g, "").trim();
  } finally {
    await parser.destroy();
  }
}

function containedDocumentPath(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.(txt|md|pdf)$/.test(storageKey)) throw new Error("Invalid storage key.");
  const root = path.resolve(runtimeEnv().CRM_DOCUMENT_ROOT);
  const candidate = path.resolve(root, storageKey);
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("Document path escaped its root.");
  return candidate;
}

function safeFileName(value: string) {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  return normalized.slice(0, 180) || "Dokument";
}

export class DocumentValidationError extends Error {
  constructor(public readonly code: string) { super(code); }
}
