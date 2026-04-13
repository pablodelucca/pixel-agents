import { useCallback, useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

// API base URL - backend server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface PaymentRecord {
  id: string;
  userId: string;
  amount: number;
  status: string;
  url: string;
  metadata: string | null;
  created: string;
  updated: string;
}

export interface PaymentHistoryState {
  payments: PaymentRecord[];
  loading: boolean;
  error: string | null;
}

export function usePaymentHistory(): PaymentHistoryState & {
  fetchPayments: () => Promise<void>;
} {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    // Only fetch if authenticated and we have a user ID
    if (!authenticated || !privyUser?.id) {
      setLoading(false);
      setPayments([]);
      return;
    }

    setLoading(true);
    setError(null);

    console.log('[usePaymentHistory] Fetching payments for privyUser.id:', privyUser.id);

    try {
      const response = await fetch(`${API_BASE_URL}/api/history/payment`, {
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
      console.log('[usePaymentHistory] Response:', data);

      if (data.success) {
        setPayments(data.data || []);
      } else {
        setPayments([]);
        if (data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      console.error('Failed to fetch payment history:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPayments([]);
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
      setPayments([]);
    }
  }, [ready, authenticated, privyUser?.id]);

  return {
    payments,
    loading,
    error,
    fetchPayments,
  };
}
