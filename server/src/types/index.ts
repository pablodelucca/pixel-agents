import { z } from 'zod';

// Server schema from database
export const ServerSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  instance_id: z.string().nullable(),
  name: z.string(),
  status: z.string().default('pending'),
  public_ip: z.string().nullable(),
  region: z.string().default('ap-singapore'),
  bundle_id: z.string().nullable(),
  ram: z.string().nullable(),
  cpu: z.string().nullable(),
  disk: z.string().nullable(),
  bandwidth: z.string().nullable(),
  password_encrypted: z.string().nullable(),
  password_key_version: z.number().default(1),
  ssh_user: z.string().nullable().optional(),
  ssh_port: z.number().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Server = z.infer<typeof ServerSchema>;

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
