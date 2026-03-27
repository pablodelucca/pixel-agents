import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// API base URL - backend server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface Office {
  id: string;
  userId: string;
  serverId: string;
  expiredAt: string | null;
  created: string;
  updated: string;
}

export interface OfficeState {
  hasOffice: boolean;
  office: Office | null;
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
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkOffice = useCallback(async () => {
    // Only check if authenticated and we have a user ID
    if (!authenticated || !privyUser?.id) {
      setLoading(false);
      setHasOffice(false);
      setOffice(null);
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
    } catch (err) {
      console.error('Failed to check office:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setHasOffice(false);
      setOffice(null);
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
    }
  }, [ready, authenticated, privyUser?.id, checkOffice]);

  return {
    hasOffice,
    office,
    loading,
    error,
    checking,
    checkOffice,
  };
}
