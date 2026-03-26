import { useEffect, useState } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import { QRCodeSVG } from 'qrcode.react';

// Base chain
const BASE_CHAIN_ID = '0x2105'; // Base mainnet (8453 in decimal)
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ERC-20 balanceOf function signature
const BALANCE_OF_SIGNATURE = '0x70a08231';

interface WalletBalanceProps {
  onRefresh?: () => void;
}

export function WalletBalance({ onRefresh }: WalletBalanceProps) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);

  const fetchUsdcBalance = async (walletAddress: string, provider: any): Promise<string> => {
    try {
      const paddedAddress = walletAddress.slice(2).padStart(64, '0');
      const data = `${BALANCE_OF_SIGNATURE}${paddedAddress}`;

      console.log('🔍 Fetching USDC balance...');
      console.log('📍 Wallet:', walletAddress);
      console.log('📝 Contract:', USDC_CONTRACT);
      console.log('📦 Data:', data);

      const result = await provider.request({
        method: 'eth_call',
        params: [{ to: USDC_CONTRACT, data: data }, 'latest'],
      });

      console.log('📥 Raw result:', result);

      const balanceInMicroUsdc = parseInt(result, 16);
      const balance = balanceInMicroUsdc / 1e6;

      console.log('💰 Balance:', balance);

      return balance.toFixed(4);
    } catch (error) {
      console.error('❌ Failed to fetch USDC balance:', error);
      return '0';
    }
  };

  const fetchBalance = async () => {
    if (!wallets.length || !authenticated) return;

    setIsLoading(true);

    // Use first EVM wallet
    const evmWallet = wallets.find((w) => w.chainId?.startsWith('eip155'));
    if (!evmWallet) {
      console.log('⚠️ No EVM wallet found');
      setIsLoading(false);
      return;
    }

    console.log('👛 Wallet address:', evmWallet.address);
    console.log('🔗 Current chain:', evmWallet.chainId);

    try {
      const provider = await evmWallet.getEthereumProvider();

      // Switch to Base chain first
      try {
        const currentChainId = await provider.request({ method: 'eth_chainId' });
        console.log('🔗 Provider chain:', currentChainId);

        if (currentChainId !== BASE_CHAIN_ID) {
          console.log('🔄 Switching to Base...');
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_ID }],
          });
        }
      } catch (switchError) {
        console.warn('⚠️ Chain switch warning:', switchError);
      }

      const balance = await fetchUsdcBalance(evmWallet.address, provider);
      setUsdcBalance(balance);
    } catch (error) {
      console.error('❌ Failed to fetch balance:', error);
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

  useEffect(() => {
    if (authenticated && wallets.length > 0) {
      fetchBalance();
    }
  }, [authenticated, wallets]);

  useEffect(() => {
    if (onRefresh) {
      fetchBalance();
    }
  }, [onRefresh]);

  const evmWallet = wallets.find((w) => w.chainId?.startsWith('eip155'));

  // If no wallet, show create wallet button
  if (!authenticated) {
    return null;
  }

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 'var(--pixel-controls-z)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '6px 12px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 160,
        }}
      >
        {/* Coin Icon */}
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #2dd4bf 0%, #14b8a6 50%, #0d9488 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            fontWeight: 'bold',
            color: '#fff',
            boxShadow: '0 0 8px rgba(45, 212, 191, 0.5)',
            border: '2px solid #5eead4',
            flexShrink: 0,
          }}
        >
          $
        </div>

        {/* Balance Container - fills remaining width */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1 }}>
          {/* USDC Label */}
          <span
            style={{
              fontSize: '14px',
              color: 'var(--pixel-text-dim)',
              fontWeight: 'normal',
              lineHeight: 1,
            }}
          >
            USDC
          </span>

          {/* Balance */}
          <span
            style={{
              fontSize: '22px',
              fontWeight: 'bold',
              color: 'var(--pixel-text)',
              fontFamily: 'monospace',
              lineHeight: 1.2,
            }}
          >
            {isLoading ? '...' : usdcBalance}
          </span>
        </div>

        {/* Add Button - on the right */}
        <button
          onClick={() => setIsDialogOpen(true)}
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

      {/* Add Funds Dialog */}
      {isDialogOpen && (
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
            onClick={() => setIsDialogOpen(false)}
          />

          {/* Dialog */}
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
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: '32px' }}>💰</span>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: 'var(--pixel-accent)',
                  marginTop: 8,
                  textTransform: 'uppercase',
                  letterSpacing: '2px',
                }}
              >
                Add USDC
              </h2>
              <p style={{ fontSize: '18px', color: 'var(--pixel-text-dim)', marginTop: 4 }}>
                Send USDC to your wallet on Base
              </p>
            </div>

            {evmWallet ? (
              <>
                {/* QR Code */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    marginBottom: 16,
                    padding: 16,
                    background: '#fff',
                    borderRadius: 0,
                  }}
                >
                  <QRCodeSVG value={evmWallet.address} size={180} level="M" />
                </div>

                {/* Address */}
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
                      fontSize: '14px',
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
                    onClick={() => window.open(`https://basescan.org/address/${evmWallet.address}`, '_blank')}
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
                {/* No Wallet - Create Wallet */}
                <p
                  style={{
                    fontSize: '18px',
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
                    fontSize: '18px',
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
                  {creatingWallet ? (
                    <>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ animation: 'spin 1s linear infinite' }}
                      >
                        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                      </svg>
                      Creating...
                    </>
                  ) : (
                    <>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                      Create Wallet
                    </>
                  )}
                </button>
              </>
            )}

            {/* Close Button */}
            <button
              onClick={() => setIsDialogOpen(false)}
              style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: '18px',
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
    </>
  );
}
