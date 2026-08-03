import { currentApiUser, unauthorized } from "../../../api-user";
import { runtimeEnv } from "../../../../db/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const document = await runtimeEnv().DB.prepare(`SELECT name,
    media_type AS mediaType, object_key AS objectKey, body
    FROM documents WHERE id = ? AND owner_id = ?`).bind(id, user.userId)
    .first<{ name: string; mediaType: string; objectKey: string | null; body: string | null }>();
  if (!document) return new Response("Not found", { status: 404 });

  let bytes: ArrayBuffer | string;
  if (document.objectKey) {
    const object = await runtimeEnv().DOCUMENTS?.get(document.objectKey);
    if (!object) return new Response("Not found", { status: 404 });
    bytes = await object.arrayBuffer();
  } else {
    bytes = document.body ?? "";
  }
  return new Response(bytes, {
    headers: {
      "content-type": document.mediaType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
      "x-content-type-options": "nosniff",
    },
  });
}
