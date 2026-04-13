import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  email?: string;
  walletAddress?: string;
  createdAt?: number;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  authenticated: boolean;
  ready: boolean;
}

export function useAuth(): AuthState & {
  login: () => void;
  logout: () => Promise<void>;
} {
  const { ready, authenticated, user: privyUser, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (ready && authenticated && privyUser) {
      const wallet = wallets.find((w) => w.address === privyUser.wallet?.address);

      setUser({
        id: privyUser.id,
        email: privyUser.email?.address,
        walletAddress: wallet?.address || privyUser.wallet?.address,
        createdAt: privyUser.createdAt?.getTime(),
      });
    } else if (ready && !authenticated) {
      setUser(null);
    }
  }, [ready, authenticated, privyUser, wallets]);

  const handleLogout = async () => {
    try {
      setError(null);
      await logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to logout');
    }
  };

  return {
    user,
    loading: !ready,
    error,
    authenticated,
    ready,
    login,
    logout: handleLogout,
  };
}
