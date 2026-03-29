import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// API base URL - backend server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Global event for credits refresh
export const CREDITS_UPDATED_EVENT = 'clawmpany:credits-updated';

// Dispatch credits update event
export function dispatchCreditsUpdated() {
  console.log('[useCredits] Dispatching credits updated event');
  window.dispatchEvent(new CustomEvent(CREDITS_UPDATED_EVENT));
}

export interface CreditsState {
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
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCredits = useCallback(async () => {
    // Only fetch if authenticated and we have a user ID
    if (!authenticated || !privyUser?.id) {
      setLoading(false);
      setBalance(0);
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

      if (data.success) {
        setBalance(data.balance || 0);
      } else {
        setBalance(0);
        if (data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      console.error('Failed to fetch credits:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setBalance(0);
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

      if (data.success) {
        setBalance(data.balance || 0);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to add credits:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  }, [authenticated, privyUser?.id]);

  const setBalanceApi = useCallback(async (newBalance: number): Promise<boolean> => {
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
        body: JSON.stringify({ balance: newBalance }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useCredits] Set balance response:', data);

      if (data.success) {
        setBalance(data.balance || 0);
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
      setBalance(0);
    }
  }, [ready, authenticated, privyUser?.id, fetchCredits]);

  // Listen for credits updated event (e.g., from payment dialog)
  useEffect(() => {
    const handleCreditsUpdated = () => {
      console.log('[useCredits] Credits updated event received, refreshing...');
      if (authenticated && privyUser?.id) {
        fetchCredits();
      }
    };

    window.addEventListener(CREDITS_UPDATED_EVENT, handleCreditsUpdated);
    return () => {
      window.removeEventListener(CREDITS_UPDATED_EVENT, handleCreditsUpdated);
    };
  }, [authenticated, privyUser?.id, fetchCredits]);

  return {
    balance,
    loading,
    error,
    fetchCredits,
    addCredits,
    setBalance: setBalanceApi,
  };
}
