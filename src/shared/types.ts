// ── Server / Office ──────────────────────────────────────────
export type ServerStatus = 'available' | 'reserved' | 'occupied' | 'offline';

export interface ServerRecord {
  id: string;
  username: string;
  ip: string;
  password: string;
  cpu: number;
  ram: number;
  storage: number;
  status: ServerStatus;
  is_purchased: boolean;
  created: string;
  updated: string;
}

export interface OfficeRecord {
  id: string;
  user_id: string;
  server_id: string;
  expired_at: string | null;
  created: string;
  updated: string;
}

export const PACKAGE_SPECS: Record<string, { cpu: number; ram: number; storage: number }> = {
  starter: { cpu: 2, ram: 2, storage: 40 },
  business: { cpu: 2, ram: 4, storage: 60 },
  enterprise: { cpu: 2, ram: 8, storage: 80 },
};

// ── Credits / Payment ────────────────────────────────────────
export interface CreditRecord {
  id: string;
  user_id: string;
  balance: number;
}

export type PaymentStatus = 'UNPAID' | 'PAID' | 'EXPIRED' | 'FAILED';

export interface PaymentRecord {
  id: string;
  user_id: string;
  amount: number;
  status: PaymentStatus;
  url: string;
  method?: string;
  metadata: Record<string, unknown>;
  created: string;
  updated: string;
}

export type TransactionType = 'DEBIT' | 'CREDIT';

export interface TransactionRecord {
  id: string;
  user_id: string;
  type: TransactionType;
  amount: number;
  desc: string;
  ref?: string;
  created: string;
  updated: string;
}

// ── Agent / OpenClaw ─────────────────────────────────────────
export interface AgentIdentity {
  name?: string;
  theme?: string;
  emoji?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  default?: boolean;
  identity?: AgentIdentity;
}

export interface ServerConfig {
  agents: AgentConfig[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ── API Response ─────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
