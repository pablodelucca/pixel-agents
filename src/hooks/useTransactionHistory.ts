import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// API base URL - backend server
const API_BASE_URL = '';

export interface TransactionRecord {
  id: string;
  userId: string;
  payment_id: string | null;
  office_id: string | null;
  type: string;
  amount: number;
  desc: string;
  created: string;
  updated: string;
}

export interface TransactionHistoryState {
  transactions: TransactionRecord[];
  loading: boolean;
  error: string | null;
}

export function useTransactionHistory(): TransactionHistoryState & {
  fetchTransactions: () => Promise<void>;
} {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    // Only fetch if authenticated and we have a user ID
    if (!authenticated || !privyUser?.id) {
      setLoading(false);
      setTransactions([]);
      return;
    }

    setLoading(true);
    setError(null);

    console.log('[useTransactionHistory] Fetching transactions for privyUser.id:', privyUser.id);

    try {
      const response = await fetch(`${API_BASE_URL}/api/history/transaction`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': privyUser.id,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('[useTransactionHistory] Response:', data);

      if (data.success) {
        setTransactions(data.data || []);
      } else {
        setTransactions([]);
        if (data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      console.error('Failed to fetch transaction history:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [authenticated, privyUser?.id]);

  // Auto-fetch when dialog might be opened (authenticated)
  useEffect(() => {
    if (ready && authenticated && privyUser?.id) {
      // Don't auto-fetch on mount, let component decide when to fetch
    } else if (ready && !authenticated) {
      setLoading(false);
      setTransactions([]);
    }
  }, [ready, authenticated, privyUser?.id]);

  return {
    transactions,
    loading,
    error,
    fetchTransactions,
  };
}
