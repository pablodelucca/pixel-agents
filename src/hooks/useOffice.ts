import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// API base URL - backend server
const API_BASE_URL = '';

export interface Office {
  id: string;
  userId: string;
  serverId: string;
  expiredAt: string | null;
  created: string;
  updated: string;
}

export interface Server {
  id: string;
  username: string;
  ip: string;
  ipPrivate?: string;
  cpu: number;
  ram: number;
  storage: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  identity?: {
    name?: string;
    emoji?: string;
  };
}

export interface OpenClawConfig {
  agents: AgentConfig[];
  error?: string;
}

export interface OfficeState {
  hasOffice: boolean;
  office: Office | null;
  server: Server | null;
  config: OpenClawConfig | null;
  loading: boolean;
  error: string | null;
  checking: boolean;
}

export function useOffice(): OfficeState & {
  checkOffice: () => Promise<void>;
} {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const [hasOffice, setHasOffice] = useState(false);
  const [office, setOffice] = useState<Office | null>(null);
  const [server, setServer] = useState<Server | null>(null);
  const [config, setConfig] = useState<OpenClawConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkOffice = useCallback(async () => {
    // Only check if authenticated and we have a user ID
    if (!authenticated || !privyUser?.id) {
      setLoading(false);
      setHasOffice(false);
      setOffice(null);
      setServer(null);
      setConfig(null);
      return;
    }

    setChecking(true);
    setError(null);

    console.log('[useOffice] Checking office for privyUser.id:', privyUser.id);

    try {
      const response = await fetch(`${API_BASE_URL}/api/offices`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': privyUser.id, // Pass Privy user ID to backend
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useOffice] Response:', data);

      setHasOffice(data.hasOffice);
      setOffice(data.office);
      setServer(data.server);
      setConfig(data.config);
    } catch (err) {
      console.error('Failed to check office:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setHasOffice(false);
      setOffice(null);
      setServer(null);
      setConfig(null);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, [authenticated, privyUser?.id]);

  // Auto-check office when user authenticates
  useEffect(() => {
    if (ready && authenticated && privyUser?.id) {
      checkOffice();
    } else if (ready && !authenticated) {
      // Reset state when logged out
      setLoading(false);
      setHasOffice(false);
      setOffice(null);
      setServer(null);
      setConfig(null);
    }
  }, [ready, authenticated, privyUser?.id, checkOffice]);

  return {
    hasOffice,
    office,
    server,
    config,
    loading,
    error,
    checking,
    checkOffice,
  };
}
