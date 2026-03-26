import { useCallback, useState } from 'react';

import type { Payment } from '../types/database.js';

export interface UsePaymentsReturn {
  payments: Payment[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getPendingPayments: () => Payment[];
}

// NOTE: This hook is currently disabled.
// TODO: Implement with your backend API or keep Supabase for database operations
export function usePayments(): UsePaymentsReturn {
  const [payments] = useState<Payment[]>([]);
  const [loading] = useState(false);
  const [error] = useState<string | null>('Payments feature not configured');

  const fetchPayments = useCallback(async () => {
    // TODO: Implement API call to your backend
    console.log('Payments hook: Implement API call to your backend');
  }, []);

  const getPendingPayments = useCallback(
    () => payments.filter((p) => p.status === 'pending'),
    [payments]
  );

  return {
    payments,
    loading,
    error,
    refetch: fetchPayments,
    getPendingPayments,
  };
}
