import { changeOwnPassword, currentApiUser, logout, requireSameOrigin, unauthorized } from "../../../api-user";

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const input = await request.json().catch(() => ({})) as { currentPassword?: string; nextPassword?: string };
  try {
    const changed = await changeOwnPassword(user, input.currentPassword ?? "", input.nextPassword ?? "");
    if (!changed) {
      return Response.json({ error: "current_password_invalid" }, { status: 400 });
    }
    await logout();
    return Response.json({ ok: true, loginRequired: true });
  } catch (error) {
    return Response.json(
      { error: "password_policy", message: error instanceof Error ? error.message : "Das Passwort ist nicht zulässig." },
      { status: 400 },
    );
  }
}
