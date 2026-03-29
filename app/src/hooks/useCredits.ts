import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// API base URL - backend server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface Credits {
  id: string;
  userId: string;
  balance: number;
  created: string;
  updated: string;
}

export interface CreditsState {
  credits: Credits | null;
  balance: number;
  loading: boolean;
  error: string | null;
}

export function useCredits(): CreditsState & {
  fetchCredits: () => Promise<void>;
  addCredits: (amount: number) => Promise<boolean>;
  setBalance: (balance: number) => Promise<boolean>;
} {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const [credits, setCredits] = useState<Credits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    // Only fetch if authenticated and we have a user ID
    if (!authenticated || !privyUser?.id) {
      setLoading(false);
      setCredits(null);
      return;
    }

    setLoading(true);
    setError(null);

    console.log('[useCredits] Fetching credits for privyUser.id:', privyUser.id);

    try {
      const response = await fetch(`${API_BASE_URL}/api/credits`, {
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
      console.log('[useCredits] Response:', data);

      if (data.success && data.credits) {
        setCredits(data.credits);
      } else {
        setCredits(null);
        if (data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      console.error('Failed to fetch credits:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setCredits(null);
    } finally {
      setLoading(false);
    }
  }, [authenticated, privyUser?.id]);

  const addCredits = useCallback(async (amount: number): Promise<boolean> => {
    if (!authenticated || !privyUser?.id) {
      return false;
    }

    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/credits/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': privyUser.id,
        },
        credentials: 'include',
        body: JSON.stringify({ amount }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useCredits] Add credits response:', data);

      if (data.success && data.credits) {
        setCredits(data.credits);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to add credits:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, [authenticated, privyUser?.id]);

  const setBalance = useCallback(async (balance: number): Promise<boolean> => {
    if (!authenticated || !privyUser?.id) {
      return false;
    }

    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/credits`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': privyUser.id,
        },
        credentials: 'include',
        body: JSON.stringify({ balance }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useCredits] Set balance response:', data);

      if (data.success && data.credits) {
        setCredits(data.credits);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to set balance:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, [authenticated, privyUser?.id]);

  // Auto-fetch credits when user authenticates
  useEffect(() => {
    if (ready && authenticated && privyUser?.id) {
      fetchCredits();
    } else if (ready && !authenticated) {
      // Reset state when logged out
      setLoading(false);
      setCredits(null);
    }
  }, [ready, authenticated, privyUser?.id, fetchCredits]);

  return {
    credits,
    balance: credits?.balance || 0,
    loading,
    error,
    fetchCredits,
    addCredits,
    setBalance,
  };
}
