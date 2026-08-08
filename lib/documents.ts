import { createHash } from "node:crypto";
import path from "node:path";

export async function saveDocument(file: File) {
  if (file.size < 1 || file.size > 5 * 1024 * 1024 || file.name.length > 180) {
    throw new DocumentValidationError("file_not_allowed");
  }
  const mediaType = allowedMediaType(file);
  if (!mediaType) throw new DocumentValidationError("file_type_not_allowed");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (mediaType === "application/pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new DocumentValidationError("file_signature_invalid");
  }
  if (mediaType !== "application/pdf" && bytes.includes(0)) {
    throw new DocumentValidationError("text_file_invalid");
  }
  const id = crypto.randomUUID();
  const extension = mediaType === "application/pdf" ? ".pdf" : mediaType === "text/markdown" ? ".md" : ".txt";
  const storageKey = `${id}${extension}`;
  return {
    id,
    name: safeFileName(file.name),
    mediaType,
    size: bytes.length,
    storageKey,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    content: bytes,
  };
}

function allowedMediaType(file: File) {
  const extension = path.extname(file.name).toLowerCase();
  const byExtension: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
  };
  const inferred = byExtension[extension];
  if (!inferred) return null;
  const declared = file.type.trim().toLowerCase();
  if (!declared || declared === "application/octet-stream") return inferred;
  return declared === inferred ? inferred : null;
}

export async function readTextDocumentContext(bytes: Buffer, mediaType: string) {
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

function safeFileName(value: string) {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  return normalized.slice(0, 180) || "Dokument";
}

export class DocumentValidationError extends Error {
  constructor(public readonly code: string) { super(code); }
}
