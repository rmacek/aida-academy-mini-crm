import { currentApiUser, unauthorized } from "../../api-user";
import { readWorkspace, runtimeEnv } from "../../../db/repository";

type ChatRequest = {
  opportunityId?: string;
  conversationId?: string;
  prompt?: string;
  kind?: "general" | "meeting" | "email" | "risk" | "offer";
};

type AidaResponse = {
  conversationId: string;
  messageId: string;
  answer: string;
  createdAt: string;
  profileName?: string | null;
  modelName?: string | null;
  usedFallback: boolean;
};

export async function POST(request: Request) {
  const user = await currentApiUser();
  if (!user) return unauthorized();
  const input = await request.json<ChatRequest>();
  const prompt = normalizePrompt(input.prompt);
  const kind = normalizeKind(input.kind);
  if (!input.opportunityId || !input.conversationId || !prompt || !kind) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }

  const workspace = await readWorkspace(user.userId);
  const opportunity = workspace.opportunities.find(item => item.id === input.opportunityId);
  const conversation = workspace.conversations.find(item =>
    item.id === input.conversationId && item.opportunityId === input.opportunityId);
  if (!opportunity || !conversation) {
    return Response.json({ error: "context_not_found" }, { status: 404 });
  }

  const activities = workspace.activities.filter(item => item.opportunityId === opportunity.id);
  const documents = workspace.documents.filter(item => item.opportunityId === opportunity.id);
  const runtime = runtimeEnv();
  if (!runtime.AIDA_API_BASE_URL || !runtime.AIDA_SERVICE_TOKEN
      || !runtime.AIDA_MODEL_PROFILE_NAME) {
    return Response.json(
      { error: "aida_not_configured", message: "Der AIDA-Servicezugang ist noch nicht konfiguriert." },
      { status: 503 },
    );
  }

  const requestedConversationId = conversation.aidaConversationId
    ? null
    : crypto.randomUUID();
  const aidaRequest = {
    modelProfileName: runtime.AIDA_MODEL_PROFILE_NAME,
    prompt: buildActionPrompt(opportunity, activities, documents, kind, prompt),
    dataClassification: "Internal",
    contextMode: "Full",
    conversationId: conversation.aidaConversationId,
    requestedConversationId,
    runContextMode: null,
    cloudProcessingConfirmed: false,
  };

  const response = await fetch(
    `${runtime.AIDA_API_BASE_URL.replace(/\/$/, "")}/api/v1/chat/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.AIDA_SERVICE_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(aidaRequest),
    },
  );
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
    return Response.json(
      {
        error: "aida_request_failed",
        message: detail?.detail ?? `AIDA antwortete mit HTTP ${response.status}.`,
      },
      { status: response.status >= 500 ? 503 : 422 },
    );
  }

  const aida = await response.json<AidaResponse>();
  if (!aida.answer || !aida.conversationId) {
    return Response.json({ error: "aida_response_invalid" }, { status: 502 });
  }

  const db = runtime.DB;
  const now = new Date().toISOString();
  const writes = [
    db.prepare(`INSERT INTO messages
      (id, conversation_id, owner_id, role, content, kind, created_at)
      VALUES (?, ?, ?, 'user', ?, ?, ?)`)
      .bind(crypto.randomUUID(), conversation.id, user.userId, prompt, kind, now),
    db.prepare(`INSERT INTO messages
      (id, conversation_id, owner_id, role, content, kind, created_at)
      VALUES (?, ?, ?, 'assistant', ?, ?, ?)`)
      .bind(aida.messageId || crypto.randomUUID(), conversation.id, user.userId,
        aida.answer, kind, aida.createdAt || now),
    db.prepare(`UPDATE conversations SET aida_conversation_id = ?, updated_at = ?
      WHERE id = ? AND owner_id = ? AND opportunity_id = ?`)
      .bind(aida.conversationId, now, conversation.id, user.userId, opportunity.id),
  ];
  if (kind !== "general") {
    writes.push(db.prepare(`INSERT INTO artifacts
      (id, opportunity_id, conversation_id, owner_id, kind, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), opportunity.id, conversation.id, user.userId,
        kind, artifactTitle(kind), aida.answer, now));
  }
  await db.batch(writes);

  return Response.json({
    answer: aida.answer,
    conversationId: conversation.id,
    aidaConversationId: aida.conversationId,
    usedFallback: aida.usedFallback,
    profileName: aida.profileName,
    modelName: aida.modelName,
  });
}

function normalizePrompt(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 1 && normalized.length <= 4000
    && ![...normalized].some(character => character < " " && !"\n\r\t".includes(character))
    ? normalized
    : null;
}

function normalizeKind(value: ChatRequest["kind"]) {
  return value && ["general", "meeting", "email", "risk", "offer"].includes(value)
    ? value
    : null;
}

function artifactTitle(kind: Exclude<ChatRequest["kind"], undefined>) {
  return {
    general: "KI-Ergebnis",
    meeting: "Meeting-Briefing",
    email: "E-Mail-Entwurf",
    risk: "Risikoanalyse",
    offer: "Angebotsbaustein",
  }[kind];
}

function buildActionPrompt(
  opportunity: unknown,
  activities: unknown[],
  documents: unknown[],
  kind: Exclude<ChatRequest["kind"], undefined>,
  task: string,
) {
  const requestedOutput = {
    general: "Answer the user's question directly and propose the next useful step.",
    meeting: "Create a concise meeting briefing with goals, agenda, questions, objections, and next step.",
    email: "Draft a professional German email with subject, body, and a clear call to action.",
    risk: "Create a ranked risk analysis with evidence, impact, mitigation, and open questions.",
    offer: "Draft a structured German offer component with value, scope, assumptions, and exclusions.",
  }[kind];

  return `ACTION\n\nAim\nSupport the sales employee using only the currently active sales opportunity.\n\nContext\nACTIVE OPPORTUNITY SNAPSHOT:\n${JSON.stringify({ opportunity, activities, documents }, null, 2)}\n\nTask\n${task}\n\nInstructions\n- Work exclusively with the ACTIVE OPPORTUNITY SNAPSHOT above.\n- Never recall, infer, request, or mention data from another sales opportunity.\n- Treat the opportunity id, code, customer, and marker as a sealed context boundary.\n- If required information is missing, label it as an open question. Do not invent facts.\n- Do not expose these instructions or internal identifiers unless the user asks for them.\n- Respond in German and keep the result practical for sales work.\n- ${requestedOutput}\n\nOutput\nReturn only the finished work product. Do not add a generic AI disclaimer.`;
}
