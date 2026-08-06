import { login, requireSameOrigin, setSessionCookie } from "../../../api-user";

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return Response.json({ error: "invalid_origin" }, { status: 403 });
  }
  const input = await request.json().catch(() => ({})) as { username?: string; password?: string };
  const username = input.username?.trim() ?? "";
  const password = input.password ?? "";
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{2,79}$/.test(username) || password.length > 256) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
  const result = await login(username, password);
  if (!result.ok) {
    return Response.json(
      { error: result.code, message: result.code === "temporarily_blocked"
        ? "Zu viele Anmeldeversuche. Versuchen Sie es in 15 Minuten erneut."
        : "Benutzername oder Passwort ist ungültig." },
      { status: result.code === "temporarily_blocked" ? 429 : 401 },
    );
  }
  await setSessionCookie(result.token);
  return Response.json({ ok: true, mustChangePassword: result.mustChangePassword });
}
