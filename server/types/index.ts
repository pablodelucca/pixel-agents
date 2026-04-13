import { z } from 'zod';

// OpenClaw config types
export const AgentIdentitySchema = z.object({
  name: z.string().optional(),
  theme: z.string().optional(),
  emoji: z.string().optional(),
});

export const AgentConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  default: z.boolean().optional(),
  workspace: z.string().optional(),
  agentDir: z.string().optional(),
  model: z.union([z.string(), z.record(z.unknown())]).optional(),
  identity: AgentIdentitySchema.optional(),
});

export const OpenClawAgentsSchema = z.object({
  defaults: z.record(z.unknown()).optional(),
  list: z.array(AgentConfigSchema).optional(),
});

export const OpenClawConfigSchema = z.object({
  meta: z.record(z.unknown()).optional(),
  wizard: z.record(z.unknown()).optional(),
  auth: z.record(z.unknown()).optional(),
  models: z.record(z.unknown()).optional(),
  agents: OpenClawAgentsSchema.optional(),
  bindings: z.array(z.record(z.unknown())).optional(),
  messages: z.record(z.unknown()).optional(),
  commands: z.record(z.unknown()).optional(),
  session: z.record(z.unknown()).optional(),
  channels: z.record(z.unknown()).optional(),
  gateway: z.record(z.unknown()).optional(),
  plugins: z.record(z.unknown()).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type OpenClawConfig = z.infer<typeof OpenClawConfigSchema>;

// SSH connection options
export interface SSHOptions {
  host: string;
  port: number;
  username: string;
  password: string;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================
// OpenClaw Session Types
// ============================================

/** Session metadata from sessions.json */
export interface SessionMeta {
  sessionId: string;
  sessionFile: string;
  chatType: 'direct' | 'channel';
  updatedAt: number;
  channel?: string;
  lastChannel?: string;
  groupId?: string;
  displayName?: string;
  model?: string;
  modelProvider?: string;
}

/** Index of all sessions */
export type SessionsIndex = Record<string, SessionMeta>;

/** Parsed chat message for frontend */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/** Session with messages */
export interface SessionWithMessages {
  sessionId: string;
  agentId: string;
  chatType: 'direct' | 'channel';
  channel?: string;
  model?: string;
  modelProvider?: string;
  updatedAt: number;
  messages: ChatMessage[];
}
