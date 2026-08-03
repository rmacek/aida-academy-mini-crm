import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  customer: text("customer").notNull(),
  value: integer("value").notNull(),
  stage: text("stage").notNull(),
  probability: integer("probability").notNull(),
  closeDate: text("close_date").notNull(),
  summary: text("summary").notNull(),
  accent: text("accent").notNull(),
  marker: text("marker").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  ownerId: text("owner_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  dueAt: text("due_at").notNull(),
  status: text("status").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  mediaType: text("media_type").notNull(),
  size: integer("size").notNull(),
  objectKey: text("object_key"),
  body: text("body"),
  createdAt: text("created_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  aidaConversationId: text("aida_conversation_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  ownerId: text("owner_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  conversationId: text("conversation_id"),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});
