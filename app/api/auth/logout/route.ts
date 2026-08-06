import { logout, requireSameOrigin } from "../../../api-user";

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  await logout();
  return Response.json({ ok: true });
}
