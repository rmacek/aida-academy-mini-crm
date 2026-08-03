import { env } from "cloudflare:workers";

export type Opportunity = {
  id: string;
  code: string;
  name: string;
  customer: string;
  value: number;
  stage: string;
  probability: number;
  closeDate: string;
  summary: string;
  accent: string;
  marker: string;
  updatedAt: string;
};

export type Activity = {
  id: string;
  opportunityId: string;
  type: "appointment" | "todo" | "note";
  title: string;
  dueAt: string;
  status: string;
  body: string;
  createdAt: string;
};

export type OpportunityDocument = {
  id: string;
  opportunityId: string;
  name: string;
  mediaType: string;
  size: number;
  createdAt: string;
};

export type Conversation = {
  id: string;
  opportunityId: string;
  title: string;
  aidaConversationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  kind: string;
  createdAt: string;
};

export type Artifact = {
  id: string;
  opportunityId: string;
  conversationId: string | null;
  kind: string;
  title: string;
  content: string;
  createdAt: string;
};

type RuntimeEnv = {
  DB: D1Database;
  DOCUMENTS?: R2Bucket;
  AIDA_API_BASE_URL?: string;
  AIDA_SERVICE_TOKEN?: string;
  AIDA_MODEL_PROFILE_NAME?: string;
  ACADEMY_DEMO_MODE?: string;
};

export function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export async function ensureWorkspace(ownerId: string): Promise<void> {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("D1 binding DB is unavailable.");

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, code TEXT NOT NULL,
      name TEXT NOT NULL, customer TEXT NOT NULL, value INTEGER NOT NULL,
      stage TEXT NOT NULL, probability INTEGER NOT NULL, close_date TEXT NOT NULL,
      summary TEXT NOT NULL, accent TEXT NOT NULL, marker TEXT NOT NULL,
      updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunities_owner_code
      ON opportunities(owner_id, code)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      type TEXT NOT NULL, title TEXT NOT NULL, due_at TEXT NOT NULL,
      status TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_activities_owner_opportunity
      ON activities(owner_id, opportunity_id, due_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL,
      object_key TEXT, body TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_documents_owner_opportunity
      ON documents(owner_id, opportunity_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      title TEXT NOT NULL, aida_conversation_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_conversations_owner_opportunity
      ON conversations(owner_id, opportunity_id, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL,
      created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_owner_conversation
      ON messages(owner_id, conversation_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY, opportunity_id TEXT NOT NULL, conversation_id TEXT,
      owner_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_artifacts_owner_opportunity
      ON artifacts(owner_id, opportunity_id, created_at)`),
  ]);

  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM opportunities WHERE owner_id = ?",
  ).bind(ownerId).first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  await db.batch(seedStatements(db, ownerId, now));
  await db.prepare("PRAGMA optimize").run();
}

function seedStatements(db: D1Database, ownerId: string, now: string) {
  const opportunitySql = `INSERT INTO opportunities
    (id, owner_id, code, name, customer, value, stage, probability, close_date,
     summary, accent, marker, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const activitySql = `INSERT INTO activities
    (id, opportunity_id, owner_id, type, title, due_at, status, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const documentSql = `INSERT INTO documents
    (id, opportunity_id, owner_id, name, media_type, size, object_key, body, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`;
  const conversationSql = `INSERT INTO conversations
    (id, opportunity_id, owner_id, title, aida_conversation_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)`;

  return [
    db.prepare(opportunitySql).bind(
      "opp-nordstern", ownerId, "OPP-2026-014", "AIDA für den Service Desk",
      "Nordstern Maschinenbau GmbH", 148000, "Lösungsdesign", 65,
      "2026-09-30", "Ein KI-gestützter Service Desk mit sicherem Produktwissen und klarer Übergabe an Menschen.",
      "violet", "NORDSTERN-KONTEXT-14", now,
    ),
    db.prepare(opportunitySql).bind(
      "opp-alpenblick", ownerId, "OPP-2026-027", "AIDA für Angebotswissen",
      "Alpenblick Energie AG", 92000, "Qualifizierung", 35,
      "2026-10-15", "Vertriebswissen zentralisieren und Angebotsentwürfe mit nachvollziehbaren Quellen erstellen.",
      "teal", "PROJEKT-SONNENWENDE-42", now,
    ),
    db.prepare(activitySql).bind(
      "act-n-1", "opp-nordstern", ownerId, "appointment", "Discovery mit Serviceleitung",
      "2026-08-06T09:30:00.000Z", "open", "Ziele, Eskalationswege und Datenklassen abstimmen.", now,
    ),
    db.prepare(activitySql).bind(
      "act-n-2", "opp-nordstern", ownerId, "todo", "Security-Fragenkatalog senden",
      "2026-08-05T15:00:00.000Z", "open", "Tenant-Isolation und On-Premise-Modell erläutern.", now,
    ),
    db.prepare(activitySql).bind(
      "act-n-3", "opp-nordstern", ownerId, "note", "Entscheiderin legt Wert auf Auditierbarkeit",
      "2026-08-02T11:00:00.000Z", "recorded", "Jede KI-Antwort soll auf eine freigegebene Quelle zurückführbar sein.", now,
    ),
    db.prepare(activitySql).bind(
      "act-a-1", "opp-alpenblick", ownerId, "appointment", "Scoping Angebotsprozess",
      "2026-08-08T13:00:00.000Z", "open", "Dokumentquellen und Freigabestufen aufnehmen.", now,
    ),
    db.prepare(activitySql).bind(
      "act-a-2", "opp-alpenblick", ownerId, "todo", "Beispielangebot anfordern",
      "2026-08-07T12:00:00.000Z", "open", "Nur synthetische oder freigegebene Unterlagen verwenden.", now,
    ),
    db.prepare(documentSql).bind(
      "doc-n-1", "opp-nordstern", ownerId, "Nordstern_Discovery_Notizen.md",
      "text/markdown", 1680, "# Discovery Nordstern\n\nZiel: Service Desk mit AIDA unterstützen.\n\nWichtig: On-Premise bevorzugt, nachvollziehbare Antworten, keine Vermischung mit anderen Verkaufschancen.\n", now,
    ),
    db.prepare(documentSql).bind(
      "doc-a-1", "opp-alpenblick", ownerId, "Alpenblick_Anforderungen.md",
      "text/markdown", 1420, "# Anforderungen Alpenblick\n\nAngebotswissen strukturieren, Freigaben respektieren und ausschließlich im Kontext OPP-2026-027 arbeiten.\n", now,
    ),
    db.prepare(conversationSql).bind(
      "chat-n-briefing", "opp-nordstern", ownerId, "Vorbereitung Discovery",
      now, now,
    ),
    db.prepare(conversationSql).bind(
      "chat-a-scope", "opp-alpenblick", ownerId, "Angebotsprozess verstehen",
      now, now,
    ),
  ];
}

export async function readWorkspace(ownerId: string) {
  await ensureWorkspace(ownerId);
  const db = runtimeEnv().DB;
  const [opportunities, activities, documents, conversations, messages, artifacts] =
    await Promise.all([
      db.prepare(`SELECT id, code, name, customer, value, stage, probability,
        close_date AS closeDate, summary, accent, marker, updated_at AS updatedAt
        FROM opportunities WHERE owner_id = ? ORDER BY code`).bind(ownerId).all<Opportunity>(),
      db.prepare(`SELECT id, opportunity_id AS opportunityId, type, title,
        due_at AS dueAt, status, body, created_at AS createdAt
        FROM activities WHERE owner_id = ? ORDER BY due_at`).bind(ownerId).all<Activity>(),
      db.prepare(`SELECT id, opportunity_id AS opportunityId, name, media_type AS mediaType,
        size, created_at AS createdAt FROM documents WHERE owner_id = ?
        ORDER BY created_at DESC`).bind(ownerId).all<OpportunityDocument>(),
      db.prepare(`SELECT id, opportunity_id AS opportunityId, title,
        aida_conversation_id AS aidaConversationId, created_at AS createdAt,
        updated_at AS updatedAt FROM conversations WHERE owner_id = ?
        ORDER BY updated_at DESC`).bind(ownerId).all<Conversation>(),
      db.prepare(`SELECT id, conversation_id AS conversationId, role, content, kind,
        created_at AS createdAt FROM messages WHERE owner_id = ?
        ORDER BY created_at`).bind(ownerId).all<Message>(),
      db.prepare(`SELECT id, opportunity_id AS opportunityId,
        conversation_id AS conversationId, kind, title, content,
        created_at AS createdAt FROM artifacts WHERE owner_id = ?
        ORDER BY created_at DESC`).bind(ownerId).all<Artifact>(),
    ]);
  return {
    opportunities: opportunities.results,
    activities: activities.results,
    documents: documents.results,
    conversations: conversations.results,
    messages: messages.results,
    artifacts: artifacts.results,
  };
}

export async function ownsOpportunity(ownerId: string, opportunityId: string) {
  const result = await runtimeEnv().DB.prepare(
    "SELECT id FROM opportunities WHERE id = ? AND owner_id = ?",
  ).bind(opportunityId, ownerId).first();
  return Boolean(result);
}
