import { currentApiUser, unauthorized } from "../../../api-user";
import { query } from "../../../../db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const result = await query<{ title: string; content: string }>("SELECT title,content FROM artifacts WHERE id=$1", [id]);
  const artifact = result.rows[0];
  if (!artifact) return new Response("Not found", { status: 404 });
  const safeName = artifact.title.normalize("NFKC").replace(/[^A-Za-z0-9ÄÖÜäöüß_-]+/g, "-").slice(0, 100) || "AIDA-Artefakt";
  return new Response(artifact.content, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.md`)}`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
