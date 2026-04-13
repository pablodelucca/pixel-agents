/**
 * Centralized database service.
 *
 * Current implementation: PocketBase SDK.
 * TODO: Replace with Supabase client — only this file needs to change.
 */
import PocketBase from 'pocketbase';

// ── Config ───────────────────────────────────────────────────
const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'admin@example.com';
const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || 'admin123';

const AUTH_TTL_MS = 50 * 60 * 1000; // re-auth every 50 min

// ── Singleton admin client with auto-refresh ─────────────────
let pbAdmin: PocketBase | null = null;
let adminAuthExpiry = 0;

/** Mutex so concurrent first-calls don't trigger multiple auths */
let authPromise: Promise<PocketBase> | null = null;

export async function getDb(): Promise<PocketBase> {
  const now = Date.now();

  // Return cached client if still valid
  if (pbAdmin && adminAuthExpiry > now) {
    return pbAdmin;
  }

  // Wait if another call is already authenticating
  if (authPromise) {
    return authPromise;
  }

  authPromise = (async () => {
    try {
      console.log('[DB] Authenticating as admin…');
      const pb = new PocketBase(POCKETBASE_URL);
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      adminAuthExpiry = Date.now() + AUTH_TTL_MS;
      console.log('[DB] Admin authenticated successfully');
      return pb;
    } catch (err) {
      console.error('[DB] Admin authentication failed:', err);
      throw new Error('Database admin authentication failed');
    } finally {
      authPromise = null;
    }
  })();

  return authPromise;
}
