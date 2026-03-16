import { createClient } from '@supabase/supabase-js';

// Read from import.meta.env (Vite injects env vars at build time)
// These are defined in .env: SUPABASE_URL and SUPABASE_ANON_KEY
const supabaseUrl = import.meta.env.SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not set. Authentication will be disabled.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export type { User, Session } from '@supabase/supabase-js';
