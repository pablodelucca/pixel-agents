import { useEffect, useState } from 'react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import { QRCodeSVG } from 'qrcode.react';

// Base chain
const BASE_CHAIN_ID = '0x2105'; // Base mainnet (8453 in decimal)
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ERC-20 balanceOf function signature
const BALANCE_OF_SIGNATURE = '0x70a08231';

interface BalanceBarProps {
  rupiahBalance?: number;
}

export function BalanceBar({ rupiahBalance = 0 }: BalanceBarProps) {
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [isLoading, setIsLoading] = useState(false);
  const [isUsdcDialogOpen, setIsUsdcDialogOpen] = useState(false);
  const [isRupiahDialogOpen, setIsRupiahDialogOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);

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

      return balance.toFixed(4);
    } catch (error) {
      console.error('Failed to fetch USDC balance:', error);
      return '0';
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

  useEffect(() => {
    if (authenticated && wallets.length > 0) {
      fetchBalance();
    }
  }, [authenticated, wallets]);

  const evmWallet = wallets.find((w) => w.chainId?.startsWith('eip155'));

  const formatRupiah = (num: number): string => {
    return num.toLocaleString('id-ID');
  };

  if (!authenticated) {
    return null;
  }

  return (
    <>
      {/* Balance Bar - Two boxes in one row */}
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
        {/* USDC Box */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '8px 12px',
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

          {/* USDC Balance Container */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 80 }}>
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
            padding: '8px 12px',
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
              fontSize: '12px',
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 80 }}>
            <span
              style={{
                fontSize: '14px',
                color: 'var(--pixel-text-dim)',
                fontWeight: 'normal',
                lineHeight: 1,
              }}
            >
              RUPIAH
            </span>
            <span
              style={{
                fontSize: '22px',
                fontWeight: 'bold',
                color: 'var(--pixel-text)',
                fontFamily: 'monospace',
                lineHeight: 1.2,
              }}
            >
              {formatRupiah(rupiahBalance)}
            </span>
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
                  {creatingWallet ? 'Creating...' : 'Create Wallet'}
                </button>
              </>
            )}

            <button
              onClick={() => setIsUsdcDialogOpen(false)}
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

      {/* Rupiah Dialog */}
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
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
            }}
            onClick={() => setIsRupiahDialogOpen(false)}
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
              <span style={{ fontSize: '32px' }}>💵</span>
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
                Top Up Rupiah
              </h2>
              <p style={{ fontSize: '18px', color: 'var(--pixel-text-dim)', marginTop: 4 }}>
                Top up IDR will be available soon
              </p>
            </div>

            <div
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '2px solid var(--pixel-border)',
                padding: '24px 16px',
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '18px', color: 'var(--pixel-text-dim)' }}>
                Top up IDR will be available soon.
              </p>
            </div>

            <button
              onClick={() => setIsRupiahDialogOpen(false)}
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
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
