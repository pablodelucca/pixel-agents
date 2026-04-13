import { usePrivy } from '@privy-io/react-auth';
import { useEffect, useRef, useState } from 'react';

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export interface UseUserSyncReturn {
  /** The synced user profile from the database, or null if not yet synced */
  profile: UserProfile | null;
  /** True while the sync request is in flight */
  syncing: boolean;
  /** Error message if sync failed */
  syncError: string | null;
}

/**
 * Sync Privy user data to the backend `users` table after login.
 *
 * Fires once per authentication cycle (guarded by a ref so re-renders
 * don't cause duplicate calls). Extracts name, email, and wallet address
 * from the Privy user object and POSTs them to `/api/users/sync`.
 */
export function useUserSync(): UseUserSyncReturn {
  const { ready, authenticated, user: privyUser } = usePrivy();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Prevent double-invocation in React StrictMode
  const syncDoneRef = useRef(false);

  useEffect(() => {
    // Reset when user logs out
    if (ready && !authenticated) {
      setProfile(null);
      setSyncError(null);
      syncDoneRef.current = false;
      return;
    }

    // Wait until Privy is ready and user is authenticated
    if (!ready || !authenticated || !privyUser?.id) return;

    // Already synced for this session
    if (syncDoneRef.current) return;
    syncDoneRef.current = true;

    const syncUser = async () => {
      setSyncing(true);
      setSyncError(null);

      try {
        // Extract profile info from Privy user
        const email = privyUser.email?.address || undefined;
        // Use linked account name, google name, or wallet as fallback
        const name =
          privyUser.google?.name ||
          privyUser.email?.address?.split('@')[0] ||
          undefined;

        const response = await fetch('/api/users/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': privyUser.id,
          },
          credentials: 'include',
          body: JSON.stringify({ name, email }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${response.status}`);
        }

        const { data } = await response.json();
        console.log('[useUserSync] User synced:', data.id);
        setProfile(data);
      } catch (err) {
        console.error('[useUserSync] Sync failed:', err);
        setSyncError(err instanceof Error ? err.message : 'Unknown error');
        // Allow retry on next render
        syncDoneRef.current = false;
      } finally {
        setSyncing(false);
      }
    };

    syncUser();
  }, [ready, authenticated, privyUser]);

  return { profile, syncing, syncError };
}
