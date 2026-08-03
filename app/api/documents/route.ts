import { currentApiUser, unauthorized } from "../../api-user";
import { ownsOpportunity, runtimeEnv } from "../../../db/repository";

export async function POST(request: Request) {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const form = await request.formData();
  const opportunityId = form.get("opportunityId");
  const file = form.get("file");
  if (typeof opportunityId !== "string" || !(file instanceof File)
      || !(await ownsOpportunity(user.userId, opportunityId))) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
  if (file.size < 1 || file.size > 5 * 1024 * 1024 || file.name.length > 180) {
    return Response.json({ error: "file_not_allowed" }, { status: 400 });
  }
  const allowed = new Set(["text/plain", "text/markdown", "application/pdf"]);
  if (!allowed.has(file.type)) {
    return Response.json({ error: "file_type_not_allowed" }, { status: 415 });
  }

  const runtime = runtimeEnv();
  if (!runtime.DOCUMENTS) {
    return Response.json({ error: "document_store_unavailable" }, { status: 503 });
  }
  const id = crypto.randomUUID();
  const objectKey = `${user.userId}/${opportunityId}/${id}`;
  await runtime.DOCUMENTS.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });
  await runtime.DB.prepare(`INSERT INTO documents
    (id, opportunity_id, owner_id, name, media_type, size, object_key, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
    .bind(id, opportunityId, user.userId, file.name, file.type,
      file.size, objectKey, new Date().toISOString()).run();
  return Response.json({ ok: true, id });
}
