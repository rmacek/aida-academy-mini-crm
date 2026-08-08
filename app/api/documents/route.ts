import { currentApiUser, forbidden, requireSameOrigin, unauthorized } from "../../api-user";
import { query } from "../../../db";
import { canAccessOpportunity, canWrite } from "../../../db/repository";
import { DocumentValidationError, saveDocument } from "../../../lib/documents";

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const user = await currentApiUser();
  if (!user) return unauthorized();
  if (!canWrite(user) || user.mustChangePassword) return forbidden();
  const form = await request.formData();
  const opportunityId = form.get("opportunityId");
  const file = form.get("file");
  if (typeof opportunityId !== "string" || !(file instanceof File)
      || !(await canAccessOpportunity(opportunityId))) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
  try {
    const saved = await saveDocument(file);
    await query(
      `INSERT INTO documents(id,opportunity_id,name,media_type,size_bytes,storage_key,checksum_sha256,content,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [saved.id, opportunityId, saved.name, saved.mediaType, saved.size, saved.storageKey,
        saved.checksum, saved.content, user.userId]);
    await query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
      VALUES ($1,'document.upload','document',$2,'succeeded')`, [user.userId, saved.id]);
    return Response.json({ ok: true, id: saved.id });
  } catch (error) {
    if (error instanceof DocumentValidationError) {
      return Response.json({ error: error.code }, { status: error.code === "file_type_not_allowed" ? 415 : 400 });
    }
    return Response.json({ error: "document_store_unavailable" }, { status: 503 });
  }
}
