import { query } from "./index";

export type CrmRole = "admin" | "sales" | "reader";

export type CrmUser = {
  userId: string;
  username: string;
  displayName: string;
  role: CrmRole;
  mustChangePassword: boolean;
  mode: "database";
};

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
  useCase: string;
  accent: string;
  marker: string;
  ownerUserId: string | null;
  ownerDisplayName: string | null;
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
  assignedTo: string | null;
  assignedDisplayName: string | null;
  createdAt: string;
};

export type OpportunityDocument = {
  id: string;
  opportunityId: string;
  name: string;
  mediaType: string;
  size: number;
  checksumSha256: string;
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

export type UserSummary = {
  id: string;
  username: string;
  displayName: string;
  role: CrmRole;
  active: boolean;
};

export type AssistantDefinition = {
  key: string;
  displayName: string;
  description: string;
  starterPrompt: string;
  actionInstructions: string;
  outputLabel: string | null;
  createsArtifact: boolean;
  usesProductKnowledge: boolean;
  modelProfileName: string | null;
  active: boolean;
};

export type ChatDispatch = {
  id: string;
  opportunityId: string;
  conversationId: string;
  assistantKey: string;
  status: "Submitting" | "Queued" | "Processing";
  submittedAt: string;
  updatedAt: string;
};

export function runtimeEnv() {
  return {
    AIDA_API_BASE_URL: process.env.AIDA_API_BASE_URL?.trim(),
    AIDA_SERVICE_TOKEN: process.env.AIDA_SERVICE_TOKEN?.trim(),
    AIDA_MODEL_PROFILE_NAME: process.env.AIDA_MODEL_PROFILE_NAME?.trim(),
    AIDA_PRODUCT_KNOWLEDGE_BASE_ID: process.env.AIDA_PRODUCT_KNOWLEDGE_BASE_ID?.trim(),
    CRM_TENANT_NAME: process.env.CRM_TENANT_NAME?.trim() || "CRM-Tenant",
  };
}

export async function readWorkspace(user: CrmUser) {
  const [opportunities, activities, documents, conversations, messages, artifacts, chatDispatches,
    users, assistants, assistantDefinitions] =
    await Promise.all([
      query<Opportunity>(`SELECT o.id, o.code, o.name, o.customer,
        o.value_eur::float8 AS value, o.stage, o.probability,
        o.close_date::text AS "closeDate", o.summary, o.use_case AS "useCase", o.accent,
        o.context_marker AS marker, o.owner_user_id AS "ownerUserId",
        u.display_name AS "ownerDisplayName", o.updated_at AS "updatedAt"
        FROM opportunities o LEFT JOIN users u ON u.id = o.owner_user_id
        ORDER BY o.updated_at DESC, o.code`),
      query<Activity>(`SELECT a.id, a.opportunity_id AS "opportunityId", a.type,
        a.title, a.due_at AS "dueAt", a.status, a.body,
        a.assigned_to AS "assignedTo", u.display_name AS "assignedDisplayName",
        a.created_at AS "createdAt"
        FROM activities a LEFT JOIN users u ON u.id = a.assigned_to
        ORDER BY a.due_at`),
      query<OpportunityDocument>(`SELECT id, opportunity_id AS "opportunityId", name,
        media_type AS "mediaType", size_bytes::float8 AS size,
        checksum_sha256 AS "checksumSha256", created_at AS "createdAt"
        FROM documents ORDER BY created_at DESC`),
      query<Conversation>(`SELECT id, opportunity_id AS "opportunityId", title,
        aida_conversation_id AS "aidaConversationId", created_at AS "createdAt",
        updated_at AS "updatedAt" FROM conversations ORDER BY updated_at DESC`),
      query<Message>(`SELECT id, conversation_id AS "conversationId", role, content,
        kind, created_at AS "createdAt" FROM messages ORDER BY created_at`),
      query<Artifact>(`SELECT id, opportunity_id AS "opportunityId",
        conversation_id AS "conversationId", kind, title, content,
        created_at AS "createdAt" FROM artifacts ORDER BY created_at DESC`),
      query<ChatDispatch>(`SELECT id, opportunity_id AS "opportunityId",
        conversation_id AS "conversationId", assistant_key AS "assistantKey", status,
        submitted_at AS "submittedAt", updated_at AS "updatedAt"
        FROM chat_dispatches WHERE status IN ('Submitting', 'Queued', 'Processing')
        ORDER BY submitted_at`),
      user.role === "admin"
        ? query<UserSummary>(`SELECT id, username, display_name AS "displayName", role, active
            FROM users ORDER BY lower(username)`)
        : Promise.resolve({ rows: [] as UserSummary[] }),
      query<AssistantDefinition>(`SELECT assistant_key AS key,display_name AS "displayName",
        description,starter_prompt AS "starterPrompt",action_instructions AS "actionInstructions",
        output_label AS "outputLabel",creates_artifact AS "createsArtifact",
        uses_product_knowledge AS "usesProductKnowledge",
        model_profile_name AS "modelProfileName",active
        FROM assistant_definitions WHERE active ORDER BY display_name`),
      user.role === "admin"
        ? query<AssistantDefinition>(`SELECT assistant_key AS key,display_name AS "displayName",
            description,starter_prompt AS "starterPrompt",action_instructions AS "actionInstructions",
            output_label AS "outputLabel",creates_artifact AS "createsArtifact",
            uses_product_knowledge AS "usesProductKnowledge",
            model_profile_name AS "modelProfileName",active
            FROM assistant_definitions ORDER BY display_name`)
        : Promise.resolve({ rows: [] as AssistantDefinition[] }),
    ]);
  return {
    tenant: runtimeEnv().CRM_TENANT_NAME,
    user,
    permissions: {
      canWrite: user.role === "admin" || user.role === "sales",
      canManageUsers: user.role === "admin",
      canManageAssistants: user.role === "admin",
    },
    opportunities: opportunities.rows,
    activities: activities.rows,
    documents: documents.rows,
    conversations: conversations.rows,
    messages: messages.rows,
    artifacts: artifacts.rows,
    chatDispatches: chatDispatches.rows,
    users: users.rows,
    assistants: assistants.rows,
    assistantDefinitions: assistantDefinitions.rows,
  };
}

export async function canAccessOpportunity(opportunityId: string) {
  const result = await query<{ id: string }>("SELECT id FROM opportunities WHERE id = $1", [opportunityId]);
  return result.rowCount === 1;
}

export async function canAccessConversation(conversationId: string, opportunityId: string) {
  const result = await query<{ id: string }>(
    "SELECT id FROM conversations WHERE id = $1 AND opportunity_id = $2",
    [conversationId, opportunityId],
  );
  return result.rowCount === 1;
}

export function canWrite(user: CrmUser) {
  return user.role === "admin" || user.role === "sales";
}
