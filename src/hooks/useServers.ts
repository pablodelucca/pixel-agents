import { useCallback, useState } from 'react';

import { useAuth } from './useAuth.js';
import type { Server } from '../types/database.js';

export interface UseServersReturn {
  servers: Server[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getServerCount: () => number;
}

// NOTE: This hook now uses Privy auth. Database operations need to be implemented with your backend API.
export function useServers(): UseServersReturn {
  const { authenticated, ready } = useAuth();
  const [servers] = useState<Server[]>([]);
  const [loading] = useState(false);
  const [error] = useState<string | null>(
    ready && authenticated ? 'Servers feature not configured' : null
  );

  const fetchServers = useCallback(async () => {
    // TODO: Implement API call to your backend using Privy auth token
    console.log('Servers hook: Implement API call to your backend');
  }, []);

  const getServerCount = useCallback(() => servers.length, [servers]);

  return {
    servers,
    loading,
    error,
    refetch: fetchServers,
    getServerCount,
  };
}
