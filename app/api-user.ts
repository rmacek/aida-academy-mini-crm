import { getChatGPTUser } from "./chatgpt-auth";
import { runtimeEnv } from "../db/repository";

export async function currentApiUser() {
  const user = await getChatGPTUser();
  if (user) return user;
  if (runtimeEnv().ACADEMY_DEMO_MODE === "local") {
    return {
      userId: "local-workshop-user",
      displayName: "Ronald Macek",
      email: "rmacek@example.invalid",
      fullName: "Ronald Macek",
      mode: "local",
    };
  }
  return null;
}

export function unauthorized() {
  return Response.json(
    { error: "authentication_required", message: "Bitte melden Sie sich an." },
    { status: 401 },
  );
}
