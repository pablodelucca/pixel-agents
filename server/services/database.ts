/**
 * Centralized database service.
 *
 * Supabase (PostgreSQL) client with service role key.
 * Service role key bypasses RLS for backend operations.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── Config ───────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ── Singleton client ─────────────────────────────────────────
let supabaseInstance: SupabaseClient | null = null;

/**
 * Get the Supabase client instance (lazy initialization).
 * Uses service role key to bypass RLS — equivalent to PocketBase admin auth.
 */
export function getDb(): SupabaseClient {
  if (!supabaseInstance) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required. ' +
        'Please check your .env file.',
      );
    }

    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('[DB] Supabase client initialized');
  }

  return supabaseInstance;
}
