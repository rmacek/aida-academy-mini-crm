import { currentApiUser, unauthorized } from "../../api-user";
import { readWorkspace } from "../../../db/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const workspace = await readWorkspace(user.userId);
  return Response.json({ user, ...workspace });
}
