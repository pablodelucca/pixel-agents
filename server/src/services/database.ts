import { createClient, SupabaseClient } from '@supabase/supabase-js';

import type { Server } from '../types/index.js';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabase;
}

/**
 * Get all servers for a user
 */
export async function getServersByUserId(userId: string): Promise<Server[]> {
  const client = getSupabase();
  const { data, error } = await client
    .from('servers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch servers: ${error.message}`);
  }

  return data as Server[];
}

/**
 * Get a single server by ID
 */
export async function getServerById(serverId: string, userId?: string): Promise<Server | null> {
  const client = getSupabase();
  let query = client.from('servers').select('*').eq('id', serverId);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.single();

  if (error) {
    if (error.code === 'PGRST116') {
      // Not found
      return null;
    }
    throw new Error(`Failed to fetch server: ${error.message}`);
  }

  return data as Server;
}

/**
 * Update a server
 */
export async function updateServer(
  serverId: string,
  updates: Partial<Server>,
  userId?: string,
): Promise<Server> {
  const client = getSupabase();
  let query = client
    .from('servers')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', serverId);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.select().single();

  if (error) {
    throw new Error(`Failed to update server: ${error.message}`);
  }

  return data as Server;
}

/**
 * Create a new server
 */
export async function createServer(server: Partial<Server>): Promise<Server> {
  const client = getSupabase();
  const { data, error } = await client
    .from('servers')
    .insert({
      ...server,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create server: ${error.message}`);
  }

  return data as Server;
}

/**
 * Delete a server
 */
export async function deleteServer(serverId: string, userId?: string): Promise<void> {
  const client = getSupabase();
  let query = client.from('servers').delete().eq('id', serverId);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete server: ${error.message}`);
  }
}
