import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

import { dispatchCreditsUpdated } from '../hooks/useCredits.js';

interface PaymentStatusDialogProps {
  onClose: () => void;
}

interface PaymentStatus {
  status: 'PAID' | 'PENDING' | 'UNPAID' | 'EXPIRED' | 'FAILED' | 'REFUNDED';
  amount: number;
  newBalance?: number;
}

export function PaymentStatusDialog({ onClose }: PaymentStatusDialogProps) {
  const { user: privyUser } = usePrivy();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null);

  useEffect(() => {
    const checkPaymentStatus = async () => {
      const startTime = Date.now();
      const MIN_LOADING_TIME = 2000; // 2 seconds minimum loading

      try {
        // Get URL params - Tripay uses these param names
        const urlParams = new URLSearchParams(window.location.search);
        const tripayRef = urlParams.get('tripay_reference');
        const merchantRef = urlParams.get('tripay_merchant_ref');

        console.log('[PaymentStatus] Checking payment:', { tripayRef, merchantRef });

        // If no params, close dialog
        if (!tripayRef || !merchantRef) {
          console.log('[PaymentStatus] No payment params found, closing');
          onClose();
          return;
        }

        const userId = privyUser?.id;
        if (!userId) {
          // Wait for minimum loading time before showing error
          const elapsed = Date.now() - startTime;
          if (elapsed < MIN_LOADING_TIME) {
            await new Promise(resolve => setTimeout(resolve, MIN_LOADING_TIME - elapsed));
          }
          setError('Please login first');
          setLoading(false);
          return;
        }

        // Call API to check status
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const response = await fetch(
          `${apiUrl}/api/credits/topup/status?tripay_ref=${tripayRef}&merchant_ref=${merchantRef}`,
          {
            method: 'GET',
            headers: {
              'x-user-id': userId,
            },
          }
        );

        const data = await response.json();

        // Clear URL params after checking
        window.history.replaceState({}, document.title, window.location.pathname);

        // If payment was successful, dispatch event to refresh credits everywhere
        if (data.success && data.data?.status === 'PAID') {
          console.log('[PaymentStatus] Payment successful, dispatching credits update...');
          dispatchCreditsUpdated();
        }

        // Wait for minimum loading time before showing result
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_LOADING_TIME) {
          await new Promise(resolve => setTimeout(resolve, MIN_LOADING_TIME - elapsed));
        }

        if (!data.success) {
          setError(data.error || 'Failed to check payment status');
        } else {
          setPaymentStatus(data.data);
        }
      } catch (err) {
        console.error('[PaymentStatus] Error:', err);
        
        // Wait for minimum loading time before showing error
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_LOADING_TIME) {
          await new Promise(resolve => setTimeout(resolve, MIN_LOADING_TIME - elapsed));
        }
        
        setError('Failed to check payment status');
      } finally {
        setLoading(false);
      }
    };

    checkPaymentStatus();
  }, [privyUser?.id, onClose]);

  if (loading) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
          }}
        />
        <div
          style={{
            position: 'relative',
            background: 'var(--pixel-bg)',
            border: '4px solid var(--pixel-border)',
            padding: '32px 48px',
            textAlign: 'center',
            boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
          }}
        >
          <Loader2
            size={48}
            style={{
              color: 'var(--pixel-accent)',
              animation: 'spin 1s linear infinite',
            }}
          />
          <p
            style={{
              marginTop: 16,
              fontSize: '20px',
              color: 'var(--pixel-text)',
            }}
          >
            Checking payment status...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.8)',
          }}
          onClick={onClose}
        />
        <div
          style={{
            position: 'relative',
            background: 'var(--pixel-bg)',
            border: '4px solid var(--pixel-border)',
            padding: '32px 48px',
            textAlign: 'center',
            boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
            maxWidth: '400px',
          }}
        >
          <XCircle size={48} style={{ color: '#ef4444' }} />
          <h2
            style={{
              marginTop: 16,
              fontSize: '24px',
              fontWeight: 'bold',
              color: 'var(--pixel-text)',
            }}
          >
            Payment Error
          </h2>
          <p
            style={{
              marginTop: 8,
              fontSize: '16px',
              color: 'var(--pixel-text-dim)',
            }}
          >
            {error}
          </p>
          <button
            onClick={onClose}
            style={{
              marginTop: 24,
              padding: '12px 32px',
              fontSize: '18px',
              fontWeight: 'bold',
              background: 'var(--pixel-btn-bg)',
              color: 'var(--pixel-text)',
              border: '2px solid var(--pixel-border)',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!paymentStatus) {
    return null;
  }

  const isPaid = paymentStatus.status === 'PAID';
  const isPending = paymentStatus.status === 'PENDING' || paymentStatus.status === 'UNPAID';
  const isFailed = paymentStatus.status === 'EXPIRED' || paymentStatus.status === 'FAILED' || paymentStatus.status === 'REFUNDED';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.8)',
        }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'relative',
          background: 'var(--pixel-bg)',
          border: '4px solid var(--pixel-border)',
          padding: '32px 48px',
          textAlign: 'center',
          boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
          maxWidth: '400px',
        }}
      >
        {isPaid && (
          <>
            <CheckCircle size={48} style={{ color: '#22c55e' }} />
            <h2
              style={{
                marginTop: 16,
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#22c55e',
              }}
            >
              Payment Success!
            </h2>
            <p
              style={{
                marginTop: 8,
                fontSize: '18px',
                color: 'var(--pixel-text)',
              }}
            >
              Rp {paymentStatus.amount?.toLocaleString('id-ID')} has been added to your balance
            </p>
            {paymentStatus.newBalance && (
              <p
                style={{
                  marginTop: 4,
                  fontSize: '16px',
                  color: 'var(--pixel-text-dim)',
                }}
              >
                New balance: Rp {paymentStatus.newBalance?.toLocaleString('id-ID')}
              </p>
            )}
          </>
        )}

        {isPending && (
          <>
            <Loader2 size={48} style={{ color: '#eab308' }} />
            <h2
              style={{
                marginTop: 16,
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#eab308',
              }}
            >
              Waiting for Payment
            </h2>
            <p
              style={{
                marginTop: 8,
                fontSize: '16px',
                color: 'var(--pixel-text-dim)',
              }}
            >
              Please complete your payment. Your balance will be updated automatically.
            </p>
          </>
        )}

        {isFailed && (
          <>
            <XCircle size={48} style={{ color: '#ef4444' }} />
            <h2
              style={{
                marginTop: 16,
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#ef4444',
              }}
            >
              Payment {paymentStatus.status}
            </h2>
            <p
              style={{
                marginTop: 8,
                fontSize: '16px',
                color: 'var(--pixel-text-dim)',
              }}
            >
              Your payment was not completed. Please try again.
            </p>
          </>
        )}

        <button
          onClick={onClose}
          style={{
            marginTop: 24,
            padding: '12px 32px',
            fontSize: '18px',
            fontWeight: 'bold',
            background: isPaid ? '#22c55e' : 'var(--pixel-btn-bg)',
            color: isPaid ? '#fff' : 'var(--pixel-text)',
            border: '2px solid var(--pixel-border)',
            cursor: 'pointer',
          }}
        >
          {isPaid ? 'Done' : 'Close'}
        </button>
      </div>
    </div>
  );
}
