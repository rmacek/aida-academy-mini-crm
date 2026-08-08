import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.CRM_E2E_BASE_URL || "http://127.0.0.1:3128";
const capturePath = process.env.MOCK_AIDA_CAPTURE;
const initialPassword = process.env.CRM_E2E_INITIAL_PASSWORD || "iqx4academy2026.";
const nextPassword = "WorkshopE2E2026!Sicher";

async function post(path, body, cookie = "", method = "POST") {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie") || "";
  return value.split(";", 1)[0];
}

async function login(password) {
  const response = await post("/api/auth/login", { username: "rmacek", password });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = cookieFrom(response);
  assert.match(cookie, /^aida_crm_session=/);
  return cookie;
}

let cookie = await login(initialPassword);
const passwordChange = await post("/api/auth/password", {
  currentPassword: initialPassword,
  nextPassword,
}, cookie);
assert.equal(passwordChange.status, 200, await passwordChange.clone().text());
cookie = await login(nextPassword);

const stateResponse = await fetch(new URL("/api/state", baseUrl), { headers: { cookie } });
assert.equal(stateResponse.status, 200, await stateResponse.clone().text());
const state = await stateResponse.json();
const opportunity = state.opportunities.find(item => item.code === "OPP-2026-101");
assert.ok(opportunity);
const conversation = state.conversations.find(item => item.opportunityId === opportunity.id);
assert.ok(conversation);

const request = {
  opportunityId: opportunity.id,
  conversationId: conversation.id,
  prompt: "Prüfe diesen UseCase und nenne die drei wichtigsten offenen Punkte.",
  assistantKey: "feasibility-analyst",
};
const accepted = await post("/api/chat", request, cookie);
assert.equal(accepted.status, 202, await accepted.clone().text());
const acceptedBody = await accepted.json();
assert.match(acceptedBody.jobId, /^[0-9a-f-]{36}$/i);

const duplicate = await post("/api/chat", request, cookie);
assert.equal(duplicate.status, 409, await duplicate.clone().text());

let terminal = null;
for (let attempt = 0; attempt < 20; attempt++) {
  const status = await post("/api/chat", { jobId: acceptedBody.jobId }, cookie, "PATCH");
  assert.ok([200, 503].includes(status.status), await status.clone().text());
  const body = await status.json();
  if (body.status === "Succeeded" || body.status === "Failed") {
    terminal = body;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.equal(terminal?.status, "Succeeded", terminal?.message);

const repeated = await post("/api/chat", { jobId: acceptedBody.jobId }, cookie, "PATCH");
assert.equal(repeated.status, 200, await repeated.clone().text());
assert.equal((await repeated.json()).status, "Succeeded");

const finalState = await (await fetch(new URL("/api/state", baseUrl), {
  headers: { cookie },
})).json();
const messages = finalState.messages.filter(item => item.conversationId === conversation.id);
assert.equal(messages.length, 2);
assert.equal(messages.filter(item => item.role === "assistant").length, 1);
assert.equal(finalState.artifacts.filter(item =>
  item.conversationId === conversation.id && item.kind === "feasibility-analyst").length, 1);
assert.equal(finalState.chatDispatches.filter(item => item.conversationId === conversation.id).length, 0);

if (capturePath) {
  const capture = JSON.parse(await readFile(capturePath, "utf8"));
  assert.equal(capture.url, "/api/v1/chat/jobs");
  assert.match(capture.body.prompt, /NORDSTERN-KONTEXT-101/);
  assert.doesNotMatch(capture.body.prompt, /PROJEKT-SONNENWENDE-42/);
  assert.ok(capture.body.prompt.length <= 16_000);
}

process.stdout.write("runtime-e2e-passed\n");
