import { useEffect, useState } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeftRight, CreditCard, ExternalLink, Receipt, X } from 'lucide-react';

import { useCredits } from '../hooks/useCredits.js';
import { usePaymentHistory } from '../hooks/usePaymentHistory.js';
import { useTransactionHistory } from '../hooks/useTransactionHistory.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';

// Function to get player sprite as data URL (head only - top 2/3)
function getPlayerSpriteDataUrl(): string | null {
  try {
    // Player uses palette 0, hue shift 0 (red skin color)
    const sprites = getCharacterSprites(0, 0);
    // Use walk down frame 1 (idle pose facing camera)
    const sprite = sprites.walk[Direction.DOWN][1];
    
    // Sprite is 16x32, we want top 2/3 for head/torso = ~21 rows
    const spriteRows = sprite.length;    // 32
    const spriteCols = sprite[0].length; // 16
    const headRows = Math.floor(spriteRows * 2 / 3); // ~21 (top 2/3)
    
    const zoom = 3;
    const outlineSize = 2;
    
    // Create canvas for head only
    const canvas = document.createElement('canvas');
    canvas.width = spriteCols * zoom;
    canvas.height = headRows * zoom;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.imageSmoothingEnabled = false;
    
    // Render only top 2/3 of sprite
    for (let r = 0; r < headRows; r++) {
      for (let c = 0; c < spriteCols; c++) {
        const color = sprite[r][c];
        if (color === '' || color === 'transparent') continue;
        ctx.fillStyle = color;
        ctx.fillRect(c * zoom, r * zoom, zoom, zoom);
      }
    }
    
    // Create a new canvas with the outline
    const outlinedCanvas = document.createElement('canvas');
    outlinedCanvas.width = canvas.width + outlineSize * 2;
    outlinedCanvas.height = canvas.height + outlineSize * 2;
    const outCtx = outlinedCanvas.getContext('2d');
    if (!outCtx) return null;
    
    outCtx.imageSmoothingEnabled = false;
    
    // Draw cyan/teal outline
    outCtx.fillStyle = '#00CED1';
    outCtx.fillRect(0, outlineSize, outlineSize, canvas.height); // left
    outCtx.fillRect(outlinedCanvas.width - outlineSize, outlineSize, outlineSize, canvas.height); // right
    outCtx.fillRect(outlineSize, 0, canvas.width, outlineSize); // top
    outCtx.fillRect(outlineSize, outlinedCanvas.height - outlineSize, canvas.width, outlineSize); // bottom
    
    // Draw the head sprite
    outCtx.drawImage(canvas, outlineSize, outlineSize);
    
    return outlinedCanvas.toDataURL('image/png');
  } catch (error) {
    console.warn('Failed to render player sprite:', error);
    return null;
  }
}

// Base chain
const BASE_CHAIN_ID = '0x2105'; // Base mainnet (8453 in decimal)
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ERC-20 balanceOf function signature
const BALANCE_OF_SIGNATURE = '0x70a08231';

interface BalanceBarProps {
  /** @deprecated Balance is now fetched automatically via useCredits hook */
  rupiahBalance?: number;
}

export function BalanceBar({ rupiahBalance: _rupiahBalanceProp }: BalanceBarProps) {
  const { authenticated, user: privyUser, logout } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { balance: rupiahBalance, loading: creditsLoading, fetchCredits } = useCredits();
  const { payments, loading: paymentsLoading, fetchPayments } = usePaymentHistory();
  const { transactions, loading: transactionsLoading, fetchTransactions } = useTransactionHistory();
  const [usdcBalance, setUsdcBalance] = useState<string>('0,0000');
  const [isLoading, setIsLoading] = useState(false);
  const [isUsdcDialogOpen, setIsUsdcDialogOpen] = useState(false);
  const [isRupiahDialogOpen, setIsRupiahDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'topup' | 'payments' | 'transactions'>('topup');
  const [topUpAmount, setTopUpAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('BRIVA'); // Default: BRI Virtual Account
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const fetchUsdcBalance = async (walletAddress: string, provider: any): Promise<string> => {
    try {
      const paddedAddress = walletAddress.slice(2).padStart(64, '0');
      const data = `${BALANCE_OF_SIGNATURE}${paddedAddress}`;

      const result = await provider.request({
        method: 'eth_call',
        params: [{ to: USDC_CONTRACT, data: data }, 'latest'],
      });

      const balanceInMicroUsdc = parseInt(result, 16);
      const balance = balanceInMicroUsdc / 1e6;

      // Format with Indonesian locale (comma for decimals, e.g., 1,2345)
      return balance.toLocaleString('id-ID', {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      });
    } catch (error) {
      console.error('Failed to fetch USDC balance:', error);
      return '0,0000';
    }
  };

  const fetchBalance = async () => {
    if (!wallets.length || !authenticated) return;

    setIsLoading(true);

    const evmWallet = wallets.find((w) => w.chainId?.startsWith('eip155'));
    if (!evmWallet) {
      setIsLoading(false);
      return;
    }

    try {
      const provider = await evmWallet.getEthereumProvider();

      try {
        const currentChainId = await provider.request({ method: 'eth_chainId' });
        if (currentChainId !== BASE_CHAIN_ID) {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_ID }],
          });
        }
      } catch (switchError) {
        console.warn('Chain switch warning:', switchError);
      }

      const balance = await fetchUsdcBalance(evmWallet.address, provider);
      setUsdcBalance(balance);
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }

    setIsLoading(false);
  };

  const handleCreateWallet = async () => {
    try {
      setCreatingWallet(true);
      await createWallet();
      console.log('Wallet created successfully');
    } catch (error) {
      console.error('Failed to create wallet:', error);
    } finally {
      setCreatingWallet(false);
    }
  };

  const copyAddress = async () => {
    const evmWallet = wallets.find((w) => w.chainId?.startsWith('eip155'));
    if (!evmWallet) return;

    try {
      await navigator.clipboard.writeText(evmWallet.address);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (error) {
      console.error('Failed to copy address:', error);
    }
  };

  const handleTopUp = async () => {
    if (!topUpAmount || parseInt(topUpAmount) === 0) return;

    setTopUpLoading(true);

    try {
      const apiUrl = '';
      const userId = privyUser?.id;

      if (!userId) {
        alert('Please login first');
        return;
      }

      const response = await fetch(`${apiUrl}/api/credits/topup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          amount: parseInt(topUpAmount),
          method: 'QRIS',
          customerName: privyUser?.google?.name || privyUser?.email?.address?.split('@')[0] || 'Customer',
          customerEmail: privyUser?.email?.address || 'customer@example.com',
          customerPhone: '08123456789', // Default phone, could be added to user profile
        }),
      });

      const data = await response.json();

      if (data.success && data.data?.checkoutUrl) {
        // Open Tripay checkout URL in new tab
        window.open(data.data.checkoutUrl, '_blank');

        // Refresh payment history
        if (activeTab === 'payments') {
          fetchPayments();
        }

        // Close dialog or reset form
        setTopUpAmount('');
      } else {
        alert(data.error || 'Failed to create payment transaction');
      }
    } catch (error) {
      console.error('Top up error:', error);
      alert('Failed to process top up. Please try again.');
    } finally {
      setTopUpLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated && wallets.length > 0) {
      fetchBalance();
      // Also fetch credits on initial load
      fetchCredits();
    }
  }, [authenticated, wallets, fetchCredits]);

  // When dialog opens, fetch all data
  useEffect(() => {
    if (isRupiahDialogOpen && authenticated) {
      fetchPayments().then(() => {
        fetchCredits();
      });
      fetchTransactions();
    }
  }, [isRupiahDialogOpen, authenticated, fetchPayments, fetchCredits, fetchTransactions]);

  // Generate player avatar from sprite
  useEffect(() => {
    if (authenticated) {
      // Small delay to ensure sprites are loaded
      const timer = setTimeout(() => {
        const url = getPlayerSpriteDataUrl();
        if (url) {
          setPlayerAvatarUrl(url);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [authenticated]);

  const evmWallet = wallets.find((w) => w.chainId?.startsWith('eip155'));

  const formatRupiah = (num: number): string => {
    return num.toLocaleString('id-ID');
  };

  if (!authenticated) {
    return null;
  }

  // Get user info from Privy
  const userEmail = privyUser?.email?.address;
  const userName = privyUser?.google?.name || privyUser?.email?.address?.split('@')[0] || 'Player';

  return (
    <>
      {/* Balance Bar - Profile + Two boxes in one row */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 'var(--pixel-controls-z)',
          display: 'flex',
          gap: 8,
        }}
      >
        {/* User Profile Box */}
        <div
          onClick={() => setIsProfileDialogOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '8px 12px',
            boxShadow: 'var(--pixel-shadow)',
            cursor: 'pointer',
          }}
        >
          {/* Avatar - Player sprite or fallback */}
          {playerAvatarUrl ? (
            <img
              src={playerAvatarUrl}
              alt={userName}
              style={{
                width: 40,
                height: 40,
                objectFit: 'contain',
                imageRendering: 'pixelated',
              }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 4,
                background: 'linear-gradient(135deg, #00CED1 0%, #008B8B 50%, #006666 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#fff',
                border: '2px solid #00CED1',
                boxShadow: '0 0 8px rgba(0, 206, 209, 0.5)',
              }}
            >
              {userName.charAt(0).toUpperCase()}
            </div>
          )}

          {/* Name & Email Container */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 150, maxWidth: 240 }}>
            <span
              style={{
                fontSize: '32px',
                fontWeight: 'bold',
                color: 'var(--pixel-text)',
                
                lineHeight: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {userName}
            </span>
            <span
              style={{
                fontSize: '20px',
                color: 'var(--pixel-text-dim)',
                lineHeight: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {userEmail || 'No email'}
            </span>
          </div>
        </div>

        {/* USDC Box */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '0px 12px',
            boxShadow: 'var(--pixel-shadow)',
          }}
        >
          {/* USDC Coin Icon */}
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 50%, #0d9488 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#fff',
              boxShadow: '0 0 8px rgba(45, 212, 191, 0.5)',
              border: '2px solid #5eead4',
              flexShrink: 0,
            }}
          >
            $
          </div>

          {/* USDC Balance Container */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 80, lineHeight: 0 }}>
            <span style={{ fontSize: '20px', color: 'var(--pixel-text-dim)', fontWeight: 'normal', lineHeight: '20px', display: 'block', margin: 0, padding: 0 }}>USDC</span>
            <span style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--pixel-text)', lineHeight: '32px', display: 'block', margin: '-8px 0 0 0', padding: 0 }}>{isLoading ? '...' : usdcBalance}</span>
          </div>

          {/* USDC Add Button */}
          <button
            onClick={() => setIsUsdcDialogOpen(true)}
            title="Add USDC"
            style={{
              padding: 4,
              background: 'var(--pixel-btn-bg)',
              border: '2px solid var(--pixel-border)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--pixel-text)' }}
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* Rupiah Box */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '0px 12px',
            boxShadow: 'var(--pixel-shadow)',
          }}
        >
          {/* Rupiah Coin Icon */}
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#fff',
              boxShadow: '0 0 8px rgba(249, 115, 22, 0.5)',
              border: '2px solid #fb923c',
              flexShrink: 0,
            }}
          >
            Rp
          </div>

          {/* Rupiah Balance Container */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 80, lineHeight: 0 }}>
            <span style={{ fontSize: '20px', color: 'var(--pixel-text-dim)', fontWeight: 'normal', lineHeight: '20px', display: 'block', margin: 0, padding: 0 }}>RUPIAH</span>
            <span style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--pixel-text)', lineHeight: '32px', display: 'block', margin: '-8px 0 0 0', padding: 0 }}>{creditsLoading ? '...' : formatRupiah(rupiahBalance)}</span>
          </div>

          {/* Rupiah Add Button */}
          <button
            onClick={() => setIsRupiahDialogOpen(true)}
            title="Top Up Rupiah"
            style={{
              padding: 4,
              background: 'var(--pixel-btn-bg)',
              border: '2px solid var(--pixel-border)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--pixel-text)' }}
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* USDC Dialog */}
      {isUsdcDialogOpen && (
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
              background: 'rgba(0, 0, 0, 0.7)',
            }}
            onClick={() => setIsUsdcDialogOpen(false)}
          />

          <div
            style={{
              position: 'relative',
              background: 'var(--pixel-bg)',
              border: '4px solid var(--pixel-border)',
              borderRadius: 0,
              padding: '24px 32px',
              width: '340px',
              maxWidth: '90vw',
              boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                <CreditCard size={32} style={{ color: 'var(--pixel-accent)' }} />
              </div>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: 'var(--pixel-accent)',
                  textTransform: 'uppercase',
                  letterSpacing: '2px',
                }}
              >
                Add USDC
              </h2>
              <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)', marginTop: 4 }}>
                Send USDC to your wallet on Base
              </p>
            </div>

            {evmWallet ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    marginBottom: 16,
                    padding: 16,
                    background: '#fff',
                  }}
                >
                  <QRCodeSVG value={evmWallet.address} size={180} level="M" />
                </div>

                <div
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '2px solid var(--pixel-border)',
                    padding: '8px 12px',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <code
                    style={{
                      fontSize: '20px',
                      color: 'var(--pixel-text)',
                      wordBreak: 'break-all',
                      flex: 1,
                    }}
                  >
                    {evmWallet.address}
                  </code>
                  <button
                    onClick={copyAddress}
                    title="Copy address"
                    style={{
                      padding: 6,
                      background: copiedAddress
                        ? 'rgba(34, 197, 94, 0.2)'
                        : 'var(--pixel-btn-bg)',
                      border: '2px solid var(--pixel-border)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {copiedAddress ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20,6 9,17 4,12" />
                      </svg>
                    ) : (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: 'var(--pixel-text)' }}
                      >
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() =>
                      window.open(
                        `https://basescan.org/address/${evmWallet.address}`,
                        '_blank',
                      )
                    }
                    title="View on Basescan"
                    style={{
                      padding: 6,
                      background: 'var(--pixel-btn-bg)',
                      border: '2px solid var(--pixel-border)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: 'var(--pixel-text)' }}
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15,3 21,3 21,9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <>
                <p
                  style={{
                    fontSize: '20px',
                    color: 'var(--pixel-text)',
                    textAlign: 'center',
                    marginBottom: 16,
                  }}
                >
                  You don't have a wallet yet. Create one to receive USDC.
                </p>
                <button
                  onClick={handleCreateWallet}
                  disabled={creatingWallet}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    fontSize: '20px',
                    fontWeight: 'bold',
                    background: 'var(--pixel-accent)',
                    color: '#fff',
                    border: '2px solid transparent',
                    cursor: creatingWallet ? 'default' : 'pointer',
                    opacity: creatingWallet ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {creatingWallet ? 'Creating...' : 'Create Wallet'}
                </button>
              </>
            )}

            <button
              onClick={() => setIsUsdcDialogOpen(false)}
              style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: '20px',
                background: 'transparent',
                color: 'var(--pixel-text-dim)',
                border: '2px solid var(--pixel-border)',
                cursor: 'pointer',
                marginTop: 8,
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Credits Dialog - New Layout with Sidebar */}
      {isRupiahDialogOpen && (
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
          {/* Backdrop */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
            }}
            onClick={() => setIsRupiahDialogOpen(false)}
          />

          {/* Dialog Container */}
          <div
            style={{
              position: 'relative',
              background: 'var(--pixel-bg)',
              border: '4px solid var(--pixel-border)',
              borderRadius: 0,
              width: '800px',
              maxWidth: '95vw',
              height: '560px',
              maxHeight: '90vh',
              boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
              zIndex: 1001,
              display: 'flex',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar */}
            <div
              style={{
                width: '240px',
                background: 'rgba(0, 0, 0, 0.2)',
                borderRight: '4px solid var(--pixel-border)',
                display: 'flex',
                flexDirection: 'column',
                padding: '12px 16px',
                gap: 16,
              }}
            >
              {/* Current Credits Box */}
              <div
                style={{
                  background: 'var(--pixel-bg)',
                  border: '2px solid var(--pixel-border)',
                  padding: '0px 16px 12px',
                  textAlign: 'center',
                }}
              >
                <p
                  style={{
                    fontSize: '20px',
                    color: 'var(--pixel-text-dim)',
                    marginTop: 4,
                    marginBottom: 8,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}
                >
                  Current Credits
                </p>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  {/* Rupiah Icon */}
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '20px',
                      fontWeight: 'bold',
                      color: '#fff',
                      border: '2px solid #fb923c',
                      flexShrink: 0,
                      alignSelf: 'center',
                    }}
                  >
                    Rp
                  </div>
                  <span
                    style={{
                      fontSize: '40px',
                      fontWeight: 'bold',
                      color: 'var(--pixel-text)',
                      lineHeight: 1,
                    }}
                  >
                    {creditsLoading ? '...' : formatRupiah(rupiahBalance)}
                  </span>
                </div>
              </div>

              {/* Navigation Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={() => setActiveTab('topup')}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    background: activeTab === 'topup' ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                    color: activeTab === 'topup' ? '#fff' : 'var(--pixel-text)',
                    border: '2px solid var(--pixel-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    textAlign: 'left',
                  }}
                >
                  <CreditCard size={24} />
                  Top Up Credits
                </button>

                <button
                  onClick={() => setActiveTab('payments')}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    background: activeTab === 'payments' ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                    color: activeTab === 'payments' ? '#fff' : 'var(--pixel-text)',
                    border: '2px solid var(--pixel-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    textAlign: 'left',
                  }}
                >
                  <Receipt size={24} />
                  Payments
                </button>

                <button
                  onClick={() => setActiveTab('transactions')}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    background: activeTab === 'transactions' ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                    color: activeTab === 'transactions' ? '#fff' : 'var(--pixel-text)',
                    border: '2px solid var(--pixel-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    textAlign: 'left',
                  }}
                >
                  <ArrowLeftRight size={24} />
                  Transactions
                </button>
              </div>

              {/* Close Button at Bottom */}
              <div style={{ marginTop: 'auto' }}>
                <button
                  onClick={() => setIsRupiahDialogOpen(false)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: '28px',
                    background: 'transparent',
                    color: 'var(--pixel-text-dim)',
                    border: '2px solid var(--pixel-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <X size={24} />
                  Close
                </button>
              </div>
            </div>

            {/* Main Content Area */}
            <div
              style={{
                flex: 1,
                padding: '12px 24px 12px',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'auto',
              }}
            >
              {/* Top Up Tab */}
              {activeTab === 'topup' && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h2
                    style={{
                      fontSize: '32px',
                      fontWeight: 'bold',
                      color: 'var(--pixel-accent)',
                      marginTop: 0,
                      marginBottom: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <CreditCard size={28} /> Top Up Credits
                  </h2>
                  <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)', marginTop: 0, marginBottom: 36 }}>
                    Add credits to your account using various payment methods.
                  </p>

                  {/* Amount Input */}
                  <div style={{ marginBottom: 16 }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '20px',
                        fontWeight: 'bold',
                        color: 'var(--pixel-text)',
                        marginBottom: 8,
                      }}
                    >
                      Amount (Rp)
                    </label>
                    <input
                      type="text"
                      value={topUpAmount}
                      onChange={(e) => {
                        // Only allow numbers
                        const value = e.target.value.replace(/[^0-9]/g, '');
                        setTopUpAmount(value);
                      }}
                      placeholder="Enter amount"
                      style={{
                        width: '100%',
                        padding: '10px 16px',
                        fontSize: '28px',
                        fontWeight: 'bold',
                        background: 'var(--pixel-bg)',
                        color: 'var(--pixel-text)',
                        border: '2px solid var(--pixel-border)',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Quick Amount Buttons */}
                  <div style={{ marginBottom: 24, display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setTopUpAmount('100000')}
                      style={{
                        flex: 1,
                        padding: '12px 8px',
                        fontSize: '28px',
                        fontWeight: 'bold',
                        background: topUpAmount === '100000' ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                        color: topUpAmount === '100000' ? '#fff' : 'var(--pixel-text)',
                        border: '2px solid var(--pixel-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Rp 100 rb
                    </button>
                    <button
                      onClick={() => setTopUpAmount('200000')}
                      style={{
                        flex: 1,
                        padding: '12px 8px',
                        fontSize: '28px',
                        fontWeight: 'bold',
                        background: topUpAmount === '200000' ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                        color: topUpAmount === '200000' ? '#fff' : 'var(--pixel-text)',
                        border: '2px solid var(--pixel-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Rp 200 rb
                    </button>
                    <button
                      onClick={() => setTopUpAmount('500000')}
                      style={{
                        flex: 1,
                        padding: '12px 8px',
                        fontSize: '28px',
                        fontWeight: 'bold',
                        background: topUpAmount === '500000' ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                        color: topUpAmount === '500000' ? '#fff' : 'var(--pixel-text)',
                        border: '2px solid var(--pixel-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Rp 500 rb
                    </button>
                    <button
                      onClick={() => setTopUpAmount('1000000')}
                      style={{
                        flex: 1,
                        padding: '12px 8px',
                        fontSize: '28px',
                        fontWeight: 'bold',
                        background: topUpAmount === '1000000' ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
                        color: topUpAmount === '1000000' ? '#fff' : 'var(--pixel-text)',
                        border: '2px solid var(--pixel-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Rp 1 jt
                    </button>
                  </div>

                  {/* Top Up Button */}
                  <div style={{ marginTop: 'auto' }}>
                  <button
                    onClick={handleTopUp}
                    disabled={!topUpAmount || parseInt(topUpAmount) === 0 || topUpLoading}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      fontSize: '28px',
                      fontWeight: 'bold',
                      background: (!topUpAmount || parseInt(topUpAmount) === 0 || topUpLoading) ? 'var(--pixel-btn-bg)' : '#4ECDC4',
                      color: (!topUpAmount || parseInt(topUpAmount) === 0 || topUpLoading) ? 'var(--pixel-text-dim)' : '#fff',
                      border: '2px solid #4ECDC4',
                      cursor: (!topUpAmount || parseInt(topUpAmount) === 0 || topUpLoading) ? 'not-allowed' : 'pointer',
                      opacity: (!topUpAmount || parseInt(topUpAmount) === 0 || topUpLoading) ? 0.6 : 1,
                    }}
                  >
                    {topUpLoading ? 'Processing...' : 'Top Up'}
                  </button>
                  </div>
                </div>
              )}

              {/* Payments Tab */}
              {activeTab === 'payments' && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h2
                    style={{
                      fontSize: '32px',
                      fontWeight: 'bold',
                      color: 'var(--pixel-accent)',
                      marginTop: 0,
                      marginBottom: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Receipt size={28} /> Payment History
                  </h2>
                  <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)', marginTop: 0, marginBottom: 36 }}>
                    View your past transactions and payment history.
                  </p>

                  {/* Payments Table */}
                  {paymentsLoading ? (
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '2px solid var(--pixel-border)',
                        padding: '48px 24px',
                        textAlign: 'center',
                      }}
                    >
                      <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)' }}>
                        Loading payments...
                      </p>
                    </div>
                  ) : payments.length === 0 ? (
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '2px solid var(--pixel-border)',
                        padding: '48px 24px',
                        textAlign: 'center',
                      }}
                    >
                      <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)' }}>
                        No payments found.
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        border: '2px solid var(--pixel-border)',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Table Header */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '3fr 3fr 2fr 2fr',
                          background: 'rgba(0, 0, 0, 0.4)',
                          borderBottom: '2px solid var(--pixel-border)',
                        }}
                      >
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Date</div>
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Amount</div>
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Status</div>
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Action</div>
                      </div>

                      {/* Table Rows */}
                      {payments.map((payment) => (
                        <div
                          key={payment.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '3fr 3fr 2fr 2fr',
                            borderBottom: '2px solid var(--pixel-border)',
                            background: 'var(--pixel-bg)',
                          }}
                        >
                          {/* Date */}
                          <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', color: '#fff', fontSize: '20px' }}>
                            {new Date(payment.created).toLocaleDateString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </div>

                          {/* Amount */}
                          <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', color: '#fff', fontSize: '20px', fontWeight: 'bold' }}>
                            Rp {payment.amount?.toLocaleString('id-ID') || '0'}
                          </div>

                          {/* Status */}
                          <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden' }}>
                            <span
                              style={{
                                padding: '4px 8px',
                                fontSize: '20px',
                                fontWeight: 'bold',
                                background: payment.status === 'PAID' ? 'rgba(34, 197, 94, 0.2)' : payment.status === 'PENDING' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                color: payment.status === 'PAID' ? '#22c55e' : payment.status === 'PENDING' ? '#eab308' : '#ef4444',
                                border: `1px solid ${payment.status === 'PAID' ? '#22c55e' : payment.status === 'PENDING' ? '#eab308' : '#ef4444'}`,
                              }}
                            >
                              {payment.status || 'UNKNOWN'}
                            </span>
                          </div>

                          {/* Action */}
                          <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden' }}>
                            {payment.url ? (
                              <button
                                onClick={() => window.open(payment.url, '_blank')}
                                title="Open payment URL"
                                style={{
                                  padding: 4,
                                  background: 'var(--pixel-btn-bg)',
                                  border: '2px solid var(--pixel-border)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <ExternalLink size={12} style={{ color: 'var(--pixel-text)' }} />
                              </button>
                            ) : (
                              <span style={{ color: 'var(--pixel-text-dim)', fontSize: '20px' }}>-</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Transactions Tab */}
              {activeTab === 'transactions' && (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h2
                    style={{
                      fontSize: '32px',
                      fontWeight: 'bold',
                      color: 'var(--pixel-accent)',
                      marginTop: 0,
                      marginBottom: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <ArrowLeftRight size={28} /> Transactions
                  </h2>
                  <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)', marginTop: 0, marginBottom: 36 }}>
                    View all your transactions and balance changes.
                  </p>

                  {/* Transactions Table */}
                  {transactionsLoading ? (
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '2px solid var(--pixel-border)',
                        padding: '48px 24px',
                        textAlign: 'center',
                      }}
                    >
                      <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)' }}>
                        Loading transactions...
                      </p>
                    </div>
                  ) : transactions.length === 0 ? (
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        border: '2px solid var(--pixel-border)',
                        padding: '48px 24px',
                        textAlign: 'center',
                      }}
                    >
                      <p style={{ fontSize: '20px', color: 'var(--pixel-text-dim)' }}>
                        No transactions found.
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        border: '2px solid var(--pixel-border)',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Table Header */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '3fr 3fr 2fr 2fr',
                          background: 'rgba(0, 0, 0, 0.4)',
                          borderBottom: '2px solid var(--pixel-border)',
                        }}
                      >
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Date</div>
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Amount</div>
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Type</div>
                        <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontWeight: 'bold', color: 'var(--pixel-text)', fontSize: '20px' }}>Action</div>
                      </div>

                      {/* Table Rows */}
                      {transactions.map((transaction) => {
                        const isDebit = transaction.type === 'DEBIT';
                        const typeColor = isDebit ? '#22c55e' : '#ef4444'; // green for DEBIT, red for CREDIT
                        
                        return (
                          <div
                            key={transaction.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '3fr 3fr 2fr 2fr',
                              borderBottom: '2px solid var(--pixel-border)',
                              background: 'var(--pixel-bg)',
                            }}
                          >
                            {/* Date */}
                            <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', color: '#fff', fontSize: '20px' }}>
                              {new Date(transaction.created).toLocaleDateString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </div>

                            {/* Amount */}
                            <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden', fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>
                              {isDebit ? '+' : '-'} Rp {transaction.amount?.toLocaleString('id-ID') || '0'}
                            </div>

                            {/* Type */}
                            <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden' }}>
                              <span
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '20px',
                                  fontWeight: 'bold',
                                  background: isDebit ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                  color: typeColor,
                                  border: `1px solid ${typeColor}`,
                                }}
                              >
                                {transaction.type || 'UNKNOWN'}
                              </span>
                            </div>

                            {/* Action */}
                            <div style={{ padding: '12px 16px', minWidth: 0, overflow: 'hidden' }}>
                              {transaction.payment_id ? (
                                <span style={{ color: '#22c55e', fontSize: '20px' }}>✓ Paid</span>
                              ) : (
                                <span style={{ color: 'var(--pixel-text-dim)', fontSize: '20px' }}>-</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Profile Dialog */}
      {isProfileDialogOpen && (
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
              background: 'rgba(0, 0, 0, 0.7)',
            }}
            onClick={() => setIsProfileDialogOpen(false)}
          />

          <div
            style={{
              position: 'relative',
              background: 'var(--pixel-bg)',
              border: '4px solid var(--pixel-border)',
              borderRadius: 0,
              padding: '24px 32px',
              width: '380px',
              maxWidth: '90vw',
              boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              {/* Large Avatar */}
              {playerAvatarUrl ? (
                <img
                  src={playerAvatarUrl}
                  alt={userName}
                  style={{
                    width: 80,
                    height: 80,
                    objectFit: 'contain',
                    imageRendering: 'pixelated',
                    margin: '0 auto 16px',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 8,
                    background: 'linear-gradient(135deg, #00CED1 0%, #008B8B 50%, #006666 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: '#fff',
                    border: '4px solid #00CED1',
                    boxShadow: '0 0 16px rgba(0, 206, 209, 0.5)',
                    margin: '0 auto 16px',
                  }}
                >
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}

              <h2
                style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: 'var(--pixel-text)',
                  marginBottom: 4,
                }}
              >
                {userName}
              </h2>
              <p
                style={{
                  fontSize: '20px',
                  color: 'var(--pixel-text-dim)',
                }}
              >
                {userEmail || 'No email'}
              </p>
            </div>

            {/* Wallet Address */}
            {evmWallet && (
              <div
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '2px solid var(--pixel-border)',
                  padding: '12px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <code
                  style={{
                    fontSize: '20px',
                    color: 'var(--pixel-text)',
                    wordBreak: 'break-all',
                    flex: 1,
                  }}
                >
                  {evmWallet.address.slice(0, 10)}...{evmWallet.address.slice(-8)}
                </code>
                <button
                  onClick={copyAddress}
                  title="Copy address"
                  style={{
                    padding: 6,
                    background: copiedAddress ? 'rgba(34, 197, 94, 0.2)' : 'var(--pixel-btn-bg)',
                    border: '2px solid var(--pixel-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {copiedAddress ? (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20,6 9,17 4,12" />
                    </svg>
                  ) : (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: 'var(--pixel-text)' }}
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() =>
                    window.open(
                      `https://basescan.org/address/${evmWallet.address}`,
                      '_blank',
                    )
                  }
                  title="View on Basescan"
                  style={{
                    padding: 6,
                    background: 'var(--pixel-btn-bg)',
                    border: '2px solid var(--pixel-border)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: 'var(--pixel-text)' }}
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15,3 21,3 21,9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
              </div>
            )}

            {/* Logout Button */}
            <button
              onClick={async () => {
                setIsLoggingOut(true);
                try {
                  await logout();
                  setIsProfileDialogOpen(false);
                } catch (error) {
                  console.error('Failed to logout:', error);
                } finally {
                  setIsLoggingOut(false);
                }
              }}
              disabled={isLoggingOut}
              style={{
                width: '100%',
                padding: '12px 16px',
                fontSize: '20px',
                fontWeight: 'bold',
                background: '#dc2626',
                color: '#fff',
                border: '2px solid #b91c1c',
                cursor: isLoggingOut ? 'default' : 'pointer',
                opacity: isLoggingOut ? 0.7 : 1,
                marginBottom: 8,
              }}
            >
              {isLoggingOut ? 'Logging out...' : 'Logout'}
            </button>

            <button
              onClick={() => setIsProfileDialogOpen(false)}
              style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: '20px',
                background: 'transparent',
                color: 'var(--pixel-text-dim)',
                border: '2px solid var(--pixel-border)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
