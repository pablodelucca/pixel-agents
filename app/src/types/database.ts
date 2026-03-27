// Database types for Clawmpany

export type ServerStatus = 'pending' | 'creating' | 'online' | 'offline' | 'error';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface Server {
  id: string;
  user_id: string;
  instance_id: string | null;
  name: string;
  status: ServerStatus;
  public_ip: string | null;
  region: string;
  bundle_id: string | null;
  ram: string | null;
  cpu: string | null;
  disk: string | null;
  bandwidth: string | null;
  password_encrypted: string | null;
  password_key_version: number;
  ssh_user: string;
  ssh_port: number;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  user_id: string | null;
  server_id: string | null;
  reference: string | null;
  merchant_ref: string | null;
  amount: number;
  status: PaymentStatus;
  payment_method: string | null;
  checkout_url: string | null;
  paid_at: string | null;
  expired_at: string | null;
  created_at: string;
}

// Agent config from OpenClaw
export interface AgentIdentity {
  name?: string;
  theme?: string;
  emoji?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  identity?: AgentIdentity;
}

export interface ServerConfig {
  agents: AgentConfig[];
}
