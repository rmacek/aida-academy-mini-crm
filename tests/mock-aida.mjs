import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";

const key = readFileSync(process.env.MOCK_AIDA_TLS_KEY);
const cert = readFileSync(process.env.MOCK_AIDA_TLS_CERT);
const output = process.env.MOCK_AIDA_CAPTURE || "/tmp/aida-crm-mock-request.json";
const jobId = "11111111-1111-4111-8111-111111111111";
let polls = 0;
let requestedConversationId = "22222222-2222-4222-8222-222222222222";

createServer({ key, cert }, (request, response) => {
  if (request.method === "GET" && request.url === `/api/v1/chat/jobs/${jobId}`) {
    polls += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(polls < 2 ? {
      jobId,
      status: "Processing",
      response: null,
      error: null,
    } : {
      jobId,
      status: "Succeeded",
      response: {
        conversationId: requestedConversationId,
        messageId: "33333333-3333-4333-8333-333333333333",
        answer: "Die synthetische Machbarkeitsprüfung wurde im isolierten Kontext erstellt.",
        createdAt: new Date().toISOString(),
        profileName: "Local Primary - E2E",
        modelName: "mock-local-model",
        usedFallback: false,
      },
      error: null,
    }));
    return;
  }

  const chunks = [];
  request.on("data", chunk => chunks.push(chunk));
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = JSON.parse(raw); } catch { /* invalid JSON is recorded below */ }
    if (typeof body?.requestedConversationId === "string") {
      requestedConversationId = body.requestedConversationId;
    }
    writeFileSync(output, JSON.stringify({ method: request.method, url: request.url, body }, null, 2));
    if (request.method !== "POST" || request.url !== "/api/v1/chat/jobs") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "Not found" }));
      return;
    }
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ jobId, status: "Queued", response: null, error: null }));
  });
}).listen(3444, "0.0.0.0", () => {
  process.stdout.write("mock-aida-ready\n");
});
