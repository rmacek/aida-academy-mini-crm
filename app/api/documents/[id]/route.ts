import { currentApiUser, forbidden, requireSameOrigin, unauthorized } from "../../../api-user";
import { query, transaction } from "../../../../db";
import { canWrite } from "../../../../db/repository";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const result = await query<{ name: string; mediaType: string; content: Buffer }>(
    `SELECT name,media_type AS "mediaType",content FROM documents WHERE id=$1`, [id]);
  const document = result.rows[0];
  if (!document) return new Response("Not found", { status: 404 });
  const bytes = Uint8Array.from(document.content);
  return new Response(bytes.buffer, { headers: {
    "content-type": document.mediaType,
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-store",
  }});
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const user = await currentApiUser();
  if (!user) return unauthorized();
  if (!canWrite(user) || user.mustChangePassword) return forbidden();
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const result = await query<{ id: string }>("SELECT id FROM documents WHERE id=$1", [id]);
  const document = result.rows[0];
  if (!document) return new Response("Not found", { status: 404 });
  await transaction(async client => {
    await client.query("DELETE FROM documents WHERE id=$1", [id]);
    await client.query(
      `INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,outcome)
       VALUES ($1,'document.delete','document',$2,'succeeded')`, [user.userId, id]);
  });
  return Response.json({ ok: true });
}
