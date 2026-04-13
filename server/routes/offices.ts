import { Router } from 'express';

import type { OfficeRecord, ServerRecord } from '../../src/shared/index.js';
import { getUserIdFromRequest } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';
import { fetchOpenClawConfig } from '../services/ssh.js';

export const officesRoutes = Router();

/**
 * GET /api/offices
 * Check if user has an active office (purchased server)
 */
officesRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);

    console.log('[/api/offices] Checking office for userId:', userId);

    if (!userId) {
      return res.json({
        success: true,
        hasOffice: false,
        office: null,
        server: null,
        config: null,
      });
    }

    const db = getDb();

    const { data: office, error: officeError } = await db
      .from('offices')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (officeError) {
      console.error('[/api/offices] DB error:', officeError);
      throw new Error(officeError.message);
    }

    if (!office) {
      console.log('[/api/offices] No office found for user:', userId);
      return res.json({
        success: true,
        hasOffice: false,
        office: null,
        server: null,
        config: null,
      });
    }

    console.log('[/api/offices] Found office:', office.id);

    if (office.expired_at) {
      const expiredAt = new Date(office.expired_at);
      if (expiredAt < new Date()) {
        console.log('[/api/offices] Office expired:', office.expired_at);
        return res.json({
          success: true,
          hasOffice: false,
          office: null,
          server: null,
          config: null,
          reason: 'expired',
        });
      }
    }

    let server = null;
    let config = null;

    if (office.server_id) {
      const { data: serverData, error: serverError } = await db
        .from('servers')
        .select('*')
        .eq('id', office.server_id)
        .maybeSingle();

      if (serverError || !serverData) {
        console.error('[/api/offices] Error fetching server:', serverError);
        server = null;
        config = { agents: [], error: 'Server not found' };
      } else {
        console.log('[/api/offices] Found server:', serverData.id);

        server = {
          id: serverData.id,
          username: serverData.username || 'root',
          ip: serverData.ip_public,
          ipPrivate: serverData.ip_private,
          cpu: serverData.cpu,
          ram: serverData.ram,
          storage: serverData.storage,
        };

        if (serverData.ip_public && serverData.password) {
          try {
            console.log('[/api/offices] Fetching OpenClaw config via SSH...');
            config = await fetchOpenClawConfig(serverData.ip_public, serverData.password, serverData.username || 'root');
            console.log('[/api/offices] OpenClaw config fetched, agents:', config.agents?.length || 0);
          } catch (sshError) {
            console.error('[/api/offices] SSH error:', sshError);
            config = { agents: [], error: 'Failed to connect to server' };
          }
        } else {
          config = { agents: [], error: 'Server not configured' };
        }
      }
    }

    res.json({
      success: true,
      hasOffice: true,
      office: {
        id: office.id,
        userId: office.user_id,
        serverId: office.server_id,
        expiredAt: office.expired_at,
        created: office.created_at,
        updated: office.updated_at,
      },
      server,
      config,
    });
  } catch (error) {
    console.error('Error fetching office:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      hasOffice: false,
      office: null,
      server: null,
      config: null,
    });
  }
});

/**
 * GET /api/offices/all
 * Get all offices for a user (DEV ONLY)
 */
officesRoutes.get('/all', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });
    }

    const db = getDb();

    const { data: offices, error } = await db
      .from('offices')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      data: (offices || []).map((office) => ({
        id: office.id,
        userId: office.user_id,
        serverId: office.server_id,
        expiredAt: office.expired_at,
        created: office.created_at,
        updated: office.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching all offices:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/offices
 * Create a new office (after purchase)
 */
officesRoutes.post('/', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { serverId, expiredAt } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });
    }

    if (!serverId) {
      return res.status(400).json({ success: false, error: 'Server ID is required' });
    }

    const db = getDb();

    const { data: office, error } = await db
      .from('offices')
      .insert({
        user_id: userId,
        server_id: serverId,
        expired_at: expiredAt || null,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      office: {
        id: office.id,
        userId: office.user_id,
        serverId: office.server_id,
        expiredAt: office.expired_at,
        created: office.created_at,
        updated: office.updated_at,
      },
    });
  } catch (error) {
    console.error('Error creating office:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
