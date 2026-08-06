import { currentApiUser, unauthorized } from "../../api-user";
import { readWorkspace } from "../../../db/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const workspace = await readWorkspace(user);
  return Response.json(workspace, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
