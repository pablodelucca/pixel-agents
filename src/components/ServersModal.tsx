import { useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

interface ServersModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onPurchaseSuccess?: () => void;
}

interface OfficePackage {
  id: string;
  name: string;
  emoji: string;
  size: string;
  employees: number;
  cpu: number;
  ram: number;
  storage: number;
  priceUsdc: number;
  priceRupiah: number;
}

const OFFICE_PACKAGES: OfficePackage[] = [
  {
    id: 'starter',
    name: 'Cozy Studio',
    emoji: '🏠',
    size: '25 m²',
    employees: 5,
    cpu: 2,
    ram: 2,
    storage: 40,
    priceUsdc: 8,
    priceRupiah: 120000,
  },
  {
    id: 'business',
    name: 'Business Suite',
    emoji: '🏢',
    size: '100 m²',
    employees: 10,
    cpu: 2,
    ram: 4,
    storage: 60,
    priceUsdc: 12,
    priceRupiah: 180000,
  },
  {
    id: 'enterprise',
    name: 'Executive Tower',
    emoji: '🏛️',
    size: '400 m²',
    employees: 20,
    cpu: 2,
    ram: 8,
    storage: 80,
    priceUsdc: 20,
    priceRupiah: 300000,
  },
];

// Fallback USDC contract address (Base mainnet) - used if backend config fails
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// API base URL
const API_BASE_URL = '';

// Helper to format countdown as MM:SS
function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

type PaymentStep = 'select' | 'checking' | 'reserving' | 'paying' | 'confirming' | 'success' | 'error';

interface ReservedOffice {
  serverId: string;
  reservedAt: string;
  packageType: string;
}

export function ServersModal({ isOpen, onClose, onPurchaseSuccess }: ServersModalProps) {
  const { authenticated, user: privyUser } = usePrivy();
  const { wallets } = useWallets();

  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string>('business');
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'usdc' | 'rupiah' | null>(null);
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('select');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [creditsBalance, setCreditsBalance] = useState<number>(0);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);
  const [reservedOffice, setReservedOffice] = useState<ReservedOffice | null>(null);
  const [countdown, setCountdown] = useState<number>(300); // 5 minutes countdown (increased from 60s)
  
  // Payment config from backend (secure)
  const [paymentConfig, setPaymentConfig] = useState<{
    recipientAddress: string;
    chainId: string;
    usdcContract: string;
  } | null>(null);

  // Ref to track reserved server ID for cleanup (survives state clears)
  const reservedServerIdRef = useRef<string | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref to track if we should cancel reservation on unmount
  const shouldCancelReservation = useRef(false);

  const selectedPkg = OFFICE_PACKAGES.find((p) => p.id === selectedPackage);
  const evmWallet = wallets.find((w) => w.chainId?.startsWith('eip155'));

  // Cleanup: Cancel reservation only when modal closes without completing payment
  useEffect(() => {
    // Mark that we should cancel if component unmounts and payment wasn't successful
    // Use ref since it persists through state changes
    if ((reservedOffice || reservedServerIdRef.current) && paymentStep !== 'success') {
      shouldCancelReservation.current = true;
    } else {
      shouldCancelReservation.current = false;
    }
  }, [reservedOffice, paymentStep]);

  // Cancel reservation on actual unmount (modal closing)
  useEffect(() => {
    return () => {
      // Use ref for server ID since state might be stale in cleanup
      const serverId = reservedServerIdRef.current;
      const userId = privyUser?.id;
      
      if (shouldCancelReservation.current && serverId && userId) {
        console.log('[Cleanup] Canceling reservation on unmount:', serverId);
        fetch(`${API_BASE_URL}/api/servers/cancel-reservation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': userId,
          },
          body: JSON.stringify({ serverId }),
        }).catch((err) => {
          console.error('Failed to cancel reservation on cleanup:', err);
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on actual unmount

  // Fetch payment config from backend (secure)
  useEffect(() => {
    if (!isOpen || !authenticated) return;
    
    const fetchPaymentConfig = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/payment/config`);
        const result = await response.json();
        
        if (result.success && result.data) {
          setPaymentConfig({
            recipientAddress: result.data.recipientAddress,
            chainId: result.data.chainId,
            usdcContract: result.data.usdcContract,
          });
          console.log('[Payment] Config loaded from backend');
        } else {
          console.error('[Payment] Failed to load config:', result.error);
        }
      } catch (error) {
        console.error('[Payment] Error fetching config:', error);
      }
    };
    
    fetchPaymentConfig();
  }, [isOpen, authenticated]);

  // Countdown timer for reservation
  useEffect(() => {
    // Start countdown when reservation is made and payment step is 'select' or 'paying'
    if (reservedOffice && (paymentStep === 'select' || paymentStep === 'paying')) {
      // Clear any existing interval
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }

      // Start new countdown
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            // Countdown expired - cancel reservation
            console.log('[Countdown] Reservation expired, canceling...');
            clearInterval(countdownIntervalRef.current!);
            
            // Cancel reservation via API
            const serverId = reservedServerIdRef.current;
            const userId = privyUser?.id;
            if (serverId && userId) {
              fetch(`${API_BASE_URL}/api/servers/cancel-reservation`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': userId,
                },
                body: JSON.stringify({ serverId }),
              }).catch((err) => {
                console.error('Failed to cancel expired reservation:', err);
              });
            }

            // Show error
            setPaymentError('Reservation expired. Please try again.');
            setPaymentStep('error');
            setReservedOffice(null);
            reservedServerIdRef.current = null;
            
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    // Cleanup interval
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [reservedOffice, paymentStep, privyUser?.id]);

  // Reset countdown when starting new reservation
  useEffect(() => {
    if (paymentStep === 'checking') {
      setCountdown(300); // 5 minutes
    }
  }, [paymentStep]);

  if (!isOpen) return null;

  // Fetch USDC balance
  const fetchUsdcBalance = async (): Promise<number> => {
    if (!evmWallet) return 0;

    // Use USDC contract from backend config if available, otherwise fallback
    const usdcContract = paymentConfig?.usdcContract || USDC_CONTRACT;
    
    try {
      const provider = await evmWallet.getEthereumProvider();
      const paddedAddress = evmWallet.address.slice(2).padStart(64, '0');
      const data = `0x70a08231${paddedAddress}`;

      const result = await provider.request({
        method: 'eth_call',
        params: [{ to: usdcContract, data: data }, 'latest'],
      });

      const balanceInMicroUsdc = parseInt(result, 16);
      return balanceInMicroUsdc / 1e6;
    } catch (error) {
      console.error('Failed to fetch USDC balance:', error);
      return 0;
    }
  };

  const handleLater = () => {
    if (onClose) {
      onClose();
    }
  };

  const handlePurchase = async () => {
    if (!authenticated || !privyUser?.id) {
      alert('Please login first to rent an office.');
      return;
    }

    // Cancel any existing reservation first (in case of retry)
    if (reservedOffice) {
      console.log('[handlePurchase] Canceling existing reservation before creating new one');
      await cancelReservation();
    }

    // Reset state
    setPaymentStep('checking');
    setPaymentMethod(null);
    setPaymentError(null);
    setReservedOffice(null);
    reservedServerIdRef.current = null; // Clear ref too
    setShowPaymentDialog(true);

    // Check availability and reserve office
    try {
      const response = await fetch(`${API_BASE_URL}/api/servers/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': privyUser.id,
        },
        body: JSON.stringify({
          packageType: selectedPackage,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        // No offices available - add small delay before showing error
        setTimeout(() => {
          setPaymentError(result.error || 'All offices are currently occupied. Please check back later!');
          setPaymentStep('error');
        }, 1500);
        return;
      }

      // Office reserved successfully - add 2 second delay for smooth UX
      setReservedOffice(result.data);
      reservedServerIdRef.current = result.data.serverId; // Store in ref for cleanup
      setTimeout(() => {
        setPaymentStep('select');
      }, 2000);
    } catch (error) {
      console.error('Failed to reserve office:', error);
      setTimeout(() => {
        setPaymentError('Oops! Something went wrong. Please try again.');
        setPaymentStep('error');
      }, 1500);
    }
  };

  const handleSelectPaymentMethod = async (method: 'usdc' | 'rupiah') => {
    setPaymentMethod(method);

    if (method === 'usdc') {
      // Check USDC balance
      setIsCheckingBalance(true);
      const balance = await fetchUsdcBalance();
      setUsdcBalance(balance);
      setIsCheckingBalance(false);

      // Check if balance is sufficient
      if (balance < (selectedPkg?.priceUsdc || 0)) {
        // Cancel reservation before showing error
        await cancelReservation();
        setPaymentError(`Not enough USDC. You have ${balance.toFixed(2)} USDC, need ${selectedPkg?.priceUsdc} USDC.`);
        setPaymentStep('error');
        return;
      }
    } else if (method === 'rupiah') {
      // Rupiah payment uses credits - check balance
      setIsCheckingBalance(true);
      
      // Fetch credits from backend
      try {
        const response = await fetch(`${API_BASE_URL}/api/credits`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': privyUser?.id || '',
          },
        });

        const data = await response.json();
        const currentBalance = data.success ? (data.balance || 0) : 0;
        setCreditsBalance(currentBalance);
        setIsCheckingBalance(false);

        if (currentBalance < (selectedPkg?.priceRupiah || 0)) {
          await cancelReservation();
          setPaymentError(`Insufficient credits. You have Rp ${currentBalance.toLocaleString('id-ID')}, need Rp ${selectedPkg?.priceRupiah?.toLocaleString('id-ID')}.`);
          setPaymentStep('error');
          return;
        }
      } catch (err) {
        setIsCheckingBalance(false);
        await cancelReservation();
        setPaymentError('Failed to check credits balance. Please try again.');
        setPaymentStep('error');
        return;
      }
    }

    setPaymentStep('paying');
  };

  const handleConfirmPayment = async () => {
    if (!evmWallet || !selectedPkg || !reservedOffice) return;

    if (paymentMethod === 'usdc') {
      try {
        setPaymentStep('paying');
        setPaymentError(null);

        // Ensure payment config is loaded
        if (!paymentConfig) {
          throw new Error('Payment configuration not loaded. Please refresh and try again.');
        }

        const provider = await evmWallet.getEthereumProvider();

        // Switch to correct network if needed
        try {
          const currentChainId = await provider.request({ method: 'eth_chainId' });
          if (currentChainId !== paymentConfig.chainId) {
            await provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: paymentConfig.chainId }],
            });
          }
        } catch (switchError: any) {
          // User rejected chain switch
          if (switchError?.code === 4001) {
            throw new Error('Please switch to Base network to continue');
          }
          console.warn('Chain switch warning:', switchError);
        }

        // Convert USDC amount to microUSDC (6 decimals)
        const amountInMicroUsdc = BigInt(Math.floor(selectedPkg.priceUsdc * 1e6));

        // Pad address to 32 bytes
        const recipientPadded = paymentConfig.recipientAddress.slice(2).padStart(64, '0');
        const amountPadded = amountInMicroUsdc.toString(16).padStart(64, '0');

        // ERC-20 transfer function signature
        const transferData = `0xa9059cbb${recipientPadded}${amountPadded}`;

        // Set to confirming BEFORE sending transaction to stop countdown
        setPaymentStep('confirming');

        // Request transaction
        const hash = await provider.request({
          method: 'eth_sendTransaction',
          params: [{
            from: evmWallet.address,
            to: paymentConfig.usdcContract,
            data: transferData,
          }],
        });

        console.log('Transaction sent:', hash);

        // Confirm purchase with backend
        const confirmResponse = await fetch(`${API_BASE_URL}/api/servers/confirm-purchase`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': privyUser?.id || '',
          },
          body: JSON.stringify({
            serverId: reservedOffice.serverId,
            packageType: selectedPackage,
            paymentMethod: 'usdc',
            txHash: hash,
          }),
        });

        const confirmResult = await confirmResponse.json();

        if (!confirmResponse.ok || !confirmResult.success) {
          throw new Error(confirmResult.error || 'Failed to confirm booking');
        }

        console.log('Purchase confirmed:', confirmResult);
        
        // Add small delay before showing success for smooth UX
        setTimeout(() => {
          setPaymentStep('success');
        }, 1500);
      } catch (error: any) {
        console.error('Payment failed:', error);

        // Cancel reservation (don't await to avoid blocking UI)
        cancelReservation().catch((err) => console.error('Failed to cancel reservation:', err));

        // Handle specific wallet errors
        let errorMessage = 'Payment was cancelled or failed';
        if (error.code === 4001) {
          errorMessage = 'Transaction rejected by user';
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        setPaymentError(errorMessage);
        setPaymentStep('error');
      }
    } else if (paymentMethod === 'rupiah') {
      // Rupiah payment using credits
      try {
        setPaymentStep('confirming');
        setPaymentError(null);

        // Call purchase-with-rupiah endpoint
        const response = await fetch(`${API_BASE_URL}/api/servers/purchase-with-rupiah`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': privyUser?.id || '',
          },
          body: JSON.stringify({
            serverId: reservedOffice.serverId,
            packageType: selectedPackage,
            packageName: selectedPkg.name,
            priceRupiah: selectedPkg.priceRupiah,
          }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Failed to purchase server');
        }

        console.log('Purchase confirmed:', result);

        // Add small delay before showing success for smooth UX
        setTimeout(() => {
          setPaymentStep('success');
        }, 1500);
      } catch (error: any) {
        console.error('Payment failed:', error);

        // Cancel reservation (don't await to avoid blocking UI)
        cancelReservation().catch((err) => console.error('Failed to cancel reservation:', err));

        const errorMessage = error.message || 'Payment was cancelled or failed';
        setPaymentError(errorMessage);
        setPaymentStep('error');
      }
    }
  };

  const cancelReservation = async () => {
    // Use ref as backup if state is cleared
    const serverIdToCancel = reservedOffice?.serverId || reservedServerIdRef.current;
    if (!serverIdToCancel || !privyUser?.id) return false;

    try {
      console.log('[cancelReservation] Canceling reservation for server:', serverIdToCancel);
      
      const response = await fetch(`${API_BASE_URL}/api/servers/cancel-reservation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': privyUser.id,
        },
        body: JSON.stringify({
          serverId: serverIdToCancel,
        }),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        console.log('[cancelReservation] Reservation cancelled successfully');
        setReservedOffice(null); // Clear reserved office state
        reservedServerIdRef.current = null; // Clear ref too
        shouldCancelReservation.current = false; // Don't try to cancel again on unmount
        return true;
      } else {
        console.error('[cancelReservation] Failed to cancel:', result.error);
        return false;
      }
    } catch (error) {
      console.error('[cancelReservation] Error:', error);
      return false;
    }
  };

  const handleClosePaymentDialog = async () => {
    // Cancel reservation if we have one and payment wasn't successful
    if (reservedOffice && paymentStep !== 'success') {
      await cancelReservation();
    }

    if (paymentStep === 'success') {
      setShowPaymentDialog(false);
      if (onPurchaseSuccess) {
        onPurchaseSuccess();
      }
      if (onClose) {
        onClose();
      }
    } else {
      setShowPaymentDialog(false);
      setPaymentStep('select');
      setPaymentMethod(null);
      setPaymentError(null);
    }
  };

  const handleBackFromPayment = () => {
    // User wants to go back from payment to select another payment method
    // Don't cancel reservation - just go back to select step
    setPaymentStep('select');
    setPaymentMethod(null);
  };

  const handleCancelFromSelect = async () => {
    // User clicked Cancel from select payment method - cancel reservation
    if (reservedOffice || reservedServerIdRef.current) {
      await cancelReservation();
    }
    
    setShowPaymentDialog(false);
    setPaymentStep('select');
    setPaymentMethod(null);
    setPaymentError(null);
  };

  const formatRupiah = (num: number): string => {
    return num.toLocaleString('id-ID');
  };

  return (
    <>
      {/* Dark backdrop - click to close if onClose is provided */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 49,
          cursor: onClose ? 'pointer' : 'default',
        }}
      />
      {/* Centered dialog */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 420,
          maxWidth: '90vw',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '12px',
          }}
        >
          <span style={{ fontSize: '26px', color: '#4ECDC4', fontWeight: 'bold' }}>
            🏢 Rent Your Office Space
          </span>
        </div>

        {/* Content */}
        <div style={{ padding: '16px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🏗️</div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: 'var(--pixel-text)',
              marginBottom: '12px',
            }}
          >
            No Active Office
          </div>
          <div
            style={{
              fontSize: '20px',
              color: 'rgba(255, 255, 255, 0.7)',
              lineHeight: 1.5,
              marginBottom: '8px',
            }}
          >
            You don't have an office space yet.
          </div>
          <div
            style={{
              fontSize: '18px',
              color: 'rgba(255, 255, 255, 0.5)',
              lineHeight: 1.4,
              marginBottom: '16px',
            }}
          >
            Pick a space that fits your team!
          </div>

          {/* Office packages */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              marginBottom: '20px',
            }}
          >
            {OFFICE_PACKAGES.map((pkg) => {
              const isSelected = selectedPackage === pkg.id;
              const isHovered = hovered === pkg.id;

              return (
                <div
                  key={pkg.id}
                  onClick={() => setSelectedPackage(pkg.id)}
                  onMouseEnter={() => setHovered(pkg.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    background: isSelected
                      ? 'rgba(78, 205, 196, 0.15)'
                      : isHovered
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(255, 255, 255, 0.03)',
                    border: isSelected
                      ? '2px solid #4ECDC4'
                      : isHovered
                        ? '1px solid rgba(78, 205, 196, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 4,
                    padding: '12px 14px',
                    textAlign: 'center',
                    minWidth: 110,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    transform: isHovered && !isSelected ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div style={{ fontSize: '24px', marginBottom: '4px' }}>{pkg.emoji}</div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: isSelected ? '#4ECDC4' : 'rgba(255, 255, 255, 0.7)',
                      fontWeight: 'bold',
                    }}
                  >
                    {pkg.name}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'rgba(255, 255, 255, 0.5)',
                      marginTop: 4,
                    }}
                  >
                    {pkg.size}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'rgba(255, 255, 255, 0.4)',
                      marginTop: 2,
                    }}
                  >
                    Up to {pkg.employees} employees
                  </div>
                  {/* Price */}
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#4ECDC4',
                      marginTop: 6,
                      fontWeight: 'bold',
                    }}
                  >
                    ${pkg.priceUsdc} / Rp{formatRupiah(pkg.priceRupiah)}
                  </div>
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'rgba(255, 255, 255, 0.4)',
                      marginTop: 2,
                    }}
                  >
                    /month
                  </div>
                  {isSelected && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#4ECDC4',
                        marginTop: 4,
                        fontWeight: 'bold',
                      }}
                    >
                      ✓ Selected
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            padding: '12px 8px 16px',
          }}
        >
          {onClose && (
            <button
              onClick={handleLater}
              onMouseEnter={() => setHovered('later')}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '10px 24px',
                fontSize: '20px',
                color: 'rgba(255, 255, 255, 0.6)',
                background: hovered === 'later' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 0,
                cursor: 'pointer',
              }}
            >
              Later
            </button>
          )}
          <button
            onClick={handlePurchase}
            onMouseEnter={() => setHovered('purchase')}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '10px 28px',
              fontSize: '20px',
              color: '#fff',
              background: hovered === 'purchase' ? 'rgba(78, 205, 196, 0.4)' : '#4ECDC4',
              border: '2px solid #4ECDC4',
              borderRadius: 0,
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Rent Office
          </button>
        </div>
      </div>

      {/* Payment Dialog */}
      {showPaymentDialog && selectedPkg && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
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
            onClick={paymentStep !== 'checking' && paymentStep !== 'reserving' && paymentStep !== 'paying' && paymentStep !== 'confirming' ? handleClosePaymentDialog : undefined}
          />

          <div
            style={{
              position: 'relative',
              background: 'var(--pixel-bg)',
              border: '4px solid var(--pixel-border)',
              borderRadius: 0,
              padding: '24px 32px',
              width: '420px',
              maxWidth: '90vw',
              boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Step: Checking availability */}
            {paymentStep === 'checking' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div
                    style={{
                      fontSize: '48px',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}
                  >
                    🏢
                  </div>
                  <h2
                    style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: 'var(--pixel-text)',
                      marginTop: 16,
                    }}
                  >
                    Finding Your Space...
                  </h2>
                  <p style={{ fontSize: '16px', color: 'var(--pixel-text-dim)', marginTop: 8 }}>
                    Checking availability for <span style={{ color: '#4ECDC4', fontWeight: 'bold' }}>{selectedPkg?.name}</span>
                  </p>
                </div>

                <style>{`
                  @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.1); opacity: 0.8; }
                  }
                `}</style>
              </>
            )}

            {/* Step: Select Payment Method */}
            {paymentStep === 'select' && reservedOffice && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <span style={{ fontSize: '48px' }}>{selectedPkg.emoji}</span>
                  <h2
                    style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: '#4ECDC4',
                      marginTop: 8,
                    }}
                  >
                    {selectedPkg.name}
                  </h2>
                  <p style={{ fontSize: '18px', color: 'var(--pixel-text)', marginTop: 4 }}>
                    {selectedPkg.size} • Up to {selectedPkg.employees} employees
                  </p>
                  
                  {/* Countdown timer */}
                  <div
                    style={{
                      marginTop: 12,
                      padding: '8px 12px',
                      background: countdown <= 60 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                      border: `1px solid ${countdown <= 60 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
                      borderRadius: 4,
                      display: 'inline-block',
                    }}
                  >
                    <span style={{ 
                      fontSize: '14px', 
                      color: countdown <= 60 ? '#ef4444' : '#22c55e',
                      fontWeight: 'bold',
                    }}>
                      ⏱️ Reservation expires in {formatCountdown(countdown)}
                    </span>
                  </div>
                </div>

                <div style={{ marginBottom: 24 }}>
                  <p style={{ fontSize: '16px', color: 'var(--pixel-text)', textAlign: 'center', marginBottom: 16 }}>
                    How would you like to pay?
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* USDC Option */}
                    <button
                      onClick={() => handleSelectPaymentMethod('usdc')}
                      disabled={!evmWallet}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '16px',
                        background: evmWallet ? 'rgba(45, 212, 191, 0.1)' : 'rgba(100, 100, 100, 0.1)',
                        border: '2px solid',
                        borderColor: evmWallet ? '#2dd4bf' : 'rgba(100, 100, 100, 0.3)',
                        borderRadius: 4,
                        cursor: evmWallet ? 'pointer' : 'not-allowed',
                        opacity: evmWallet ? 1 : 0.5,
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 50%, #0d9488 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '20px',
                          fontWeight: 'bold',
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        $
                      </div>
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: evmWallet ? '#2dd4bf' : 'var(--pixel-text-dim)' }}>
                          Pay with USDC
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--pixel-text-dim)' }}>
                          ${selectedPkg.priceUsdc} USDC on Base
                        </div>
                      </div>
                      {!evmWallet && (
                        <span style={{ fontSize: '12px', color: '#ef4444' }}>No wallet</span>
                      )}
                    </button>

                    {/* Rupiah Option */}
                    <button
                      onClick={() => handleSelectPaymentMethod('rupiah')}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '16px',
                        background: 'rgba(249, 115, 22, 0.1)',
                        border: '2px solid #f97316',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        Rp
                      </div>
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#f97316' }}>
                          Pay with Credits
                        </div>
                        <div style={{ fontSize: '14px', color: 'var(--pixel-text-dim)' }}>
                          Rp {formatRupiah(selectedPkg.priceRupiah)}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleCancelFromSelect}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    fontSize: '18px',
                    background: 'transparent',
                    color: 'var(--pixel-text-dim)',
                    border: '2px solid var(--pixel-border)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </>
            )}

            {/* Step: Paying / Confirming */}
            {paymentStep === 'paying' && paymentMethod && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <span style={{ fontSize: '48px' }}>
                    {paymentMethod === 'usdc' ? '💰' : '💵'}
                  </span>
                  <h2
                    style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: 'var(--pixel-text)',
                      marginTop: 8,
                    }}
                  >
                    Confirm Payment
                  </h2>
                  <p style={{ fontSize: '18px', color: 'var(--pixel-text-dim)', marginTop: 8 }}>
                    One month rent for {selectedPkg.name}:
                  </p>
                  <div
                    style={{
                      fontSize: '32px',
                      fontWeight: 'bold',
                      color: paymentMethod === 'usdc' ? '#2dd4bf' : '#f97316',
                      marginTop: 8,
                    }}
                  >
                    {paymentMethod === 'usdc' ? `$${selectedPkg.priceUsdc} USDC` : `Rp ${formatRupiah(selectedPkg.priceRupiah)}`}
                  </div>
                  {paymentMethod === 'usdc' && (
                    <p style={{ fontSize: '14px', color: 'var(--pixel-text-dim)', marginTop: 8 }}>
                      Your balance: {isCheckingBalance ? '...' : `${usdcBalance.toFixed(2)} USDC`}
                    </p>
                  )}
                  {paymentMethod === 'rupiah' && (
                    <p style={{ fontSize: '14px', color: 'var(--pixel-text-dim)', marginTop: 8 }}>
                      Your credits: {isCheckingBalance ? '...' : `Rp ${creditsBalance.toLocaleString('id-ID')}`}
                    </p>
                  )}
                  
                  {/* Countdown timer */}
                  <div
                    style={{
                      marginTop: 12,
                      padding: '6px 10px',
                      background: countdown <= 60 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(251, 191, 36, 0.1)',
                      border: `1px solid ${countdown <= 60 ? 'rgba(239, 68, 68, 0.3)' : 'rgba(251, 191, 36, 0.3)'}`,
                      borderRadius: 4,
                      display: 'inline-block',
                    }}
                  >
                    <span style={{ 
                      fontSize: '12px', 
                      color: countdown <= 60 ? '#ef4444' : '#fbbf24',
                      fontWeight: 'bold',
                    }}>
                      ⏱️ {formatCountdown(countdown)} remaining
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={handleBackFromPayment}
                    disabled={isCheckingBalance}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      fontSize: '18px',
                      background: 'transparent',
                      color: 'var(--pixel-text)',
                      border: '2px solid var(--pixel-border)',
                      cursor: 'pointer',
                      opacity: isCheckingBalance ? 0.5 : 1,
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmPayment}
                    disabled={isCheckingBalance}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      fontSize: '18px',
                      fontWeight: 'bold',
                      background: paymentMethod === 'usdc' ? '#2dd4bf' : '#f97316',
                      color: '#fff',
                      border: '2px solid transparent',
                      cursor: 'pointer',
                      opacity: isCheckingBalance ? 0.5 : 1,
                    }}
                  >
                    Pay Now
                  </button>
                </div>
              </>
            )}

            {/* Step: Confirming purchase */}
            {paymentStep === 'confirming' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <div
                    style={{
                      fontSize: '48px',
                      animation: 'spin 1s linear infinite',
                    }}
                  >
                    🏠
                  </div>
                  <h2
                    style={{
                      fontSize: '24px',
                      fontWeight: 'bold',
                      color: 'var(--pixel-text)',
                      marginTop: 16,
                    }}
                  >
                    Setting Up Your Office...
                  </h2>
                  <p style={{ fontSize: '14px', color: 'var(--pixel-text-dim)', marginTop: 8 }}>
                    Preparing the keys to your new workspace!
                  </p>
                </div>

                <style>{`
                  @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </>
            )}

            {/* Step: Success */}
            {paymentStep === 'success' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <span style={{ fontSize: '64px' }}>🎉</span>
                  <h2
                    style={{
                      fontSize: '28px',
                      fontWeight: 'bold',
                      color: '#22c55e',
                      marginTop: 16,
                    }}
                  >
                    You're All Set!
                  </h2>
                  <p style={{ fontSize: '18px', color: 'var(--pixel-text)', marginTop: 8 }}>
                    Your {selectedPkg.name} is ready!
                  </p>
                  <p style={{ fontSize: '14px', color: 'var(--pixel-text-dim)', marginTop: 8 }}>
                    Rent is valid for 30 days. Time to get to work! 💼
                  </p>
                </div>

                <button
                  onClick={handleClosePaymentDialog}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    background: '#22c55e',
                    color: '#fff',
                    border: '2px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  Enter My Office
                </button>
              </>
            )}

            {/* Step: Error */}
            {paymentStep === 'error' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                  <span style={{ fontSize: '64px' }}>😕</span>
                  <h2
                    style={{
                      fontSize: '28px',
                      fontWeight: 'bold',
                      color: '#ef4444',
                      marginTop: 16,
                    }}
                  >
                    {paymentError?.includes('expired') ? 'Reservation Expired' :
                     paymentError?.includes('No') && paymentError?.includes('available') ? `${selectedPkg?.name} Unavailable` : 
                     paymentError?.includes('Insufficient') || paymentError?.includes('Not enough') ? 'Insufficient Balance' :
                     'Payment Failed'}
                  </h2>
                  <p style={{ fontSize: '16px', color: 'var(--pixel-text)', marginTop: 8 }}>
                    {paymentError?.includes('expired')
                      ? 'Your reservation timed out. Please try again to reserve a new office.'
                      : paymentError?.includes('No') && paymentError?.includes('available')
                      ? `No ${selectedPkg?.name} offices available right now. Try another package or check back soon!`
                      : paymentError?.includes('Insufficient') || paymentError?.includes('Not enough')
                      ? 'Top up your USDC balance and try again.'
                      : paymentError || 'Something went wrong. Please try again.'}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={handleClosePaymentDialog}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      fontSize: '18px',
                      background: 'transparent',
                      color: 'var(--pixel-text)',
                      border: '2px solid var(--pixel-border)',
                      cursor: 'pointer',
                    }}
                  >
                    Close
                  </button>
                  {!(paymentError?.includes('No') && paymentError?.includes('available')) && (
                    <button
                      onClick={handlePurchase}
                      style={{
                        flex: 1,
                        padding: '12px 16px',
                        fontSize: '18px',
                        background: '#4ECDC4',
                        color: '#fff',
                        border: '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    >
                      Try Again
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
