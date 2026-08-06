import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";

const key = readFileSync(process.env.MOCK_AIDA_TLS_KEY);
const cert = readFileSync(process.env.MOCK_AIDA_TLS_CERT);
const output = process.env.MOCK_AIDA_CAPTURE || "/tmp/aida-crm-mock-request.json";

createServer({ key, cert }, (request, response) => {
  const chunks = [];
  request.on("data", chunk => chunks.push(chunk));
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try { body = JSON.parse(raw); } catch { /* invalid JSON is recorded below */ }
    writeFileSync(output, JSON.stringify({ method: request.method, url: request.url, body }, null, 2));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      conversationId: "22222222-2222-4222-8222-222222222222",
      messageId: "33333333-3333-4333-8333-333333333333",
      answer: "Die synthetische Machbarkeitsprüfung wurde im isolierten Kontext erstellt.",
      createdAt: new Date().toISOString(),
      profileName: "Local Primary - E2E",
      modelName: "mock-local-model",
      usedFallback: false,
    }));
  });
}).listen(3444, "0.0.0.0", () => {
  process.stdout.write("mock-aida-ready\n");
});
