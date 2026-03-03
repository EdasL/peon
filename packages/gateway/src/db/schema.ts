import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  googleId: text("google_id").unique(),
  githubId: text("github_id").unique(),
  githubAccessToken: text("github_access_token"),
  lobuAgentId: text("lobu_agent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  repoUrl: text("repo_url"),
  repoBranch: text("repo_branch").default("main"),
  templateId: text("template_id").notNull(),
  status: text("status", { enum: ["creating", "running", "stopped", "error"] }).default("stopped").notNull(),
  deploymentName: text("deployment_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["anthropic", "openai"] }).notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  description: text("description").default("").notNull(),
  status: text("status", { enum: ["pending", "in_progress", "completed"] }).default("pending").notNull(),
  owner: text("owner"),
  boardColumn: text("board_column", { enum: ["backlog", "todo", "in_progress", "qa", "done"] }).default("backlog").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ApiKey = typeof apiKeys.$inferSelect
export type ChatMessage = typeof chatMessages.$inferSelect
export type Task = typeof tasks.$inferSelect
