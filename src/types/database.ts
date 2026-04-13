// Re-export shared types for backward compatibility
// New code should import directly from '@/shared'
export type {
  AgentConfig,
  AgentIdentity,
  ChatMessage,
  ServerConfig,
} from '../shared';

// App-specific types that don't belong in shared
export interface Server {
  id: string;
  user_id: string;
  instance_id: string | null;
  name: string;
  status: string;
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
  status: string;
  payment_method: string | null;
  checkout_url: string | null;
  paid_at: string | null;
  expired_at: string | null;
  created_at: string;
}
