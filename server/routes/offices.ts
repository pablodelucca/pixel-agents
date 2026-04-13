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

    const pb = await getDb();

    try {
      const office = await pb.collection('office').getFirstListItem<OfficeRecord>(
        `user_id="${userId}"`,
      );

      console.log('[/api/offices] Found office:', office);

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
        try {
          const serverData = await pb.collection('server').getOne<ServerRecord>(office.server_id);
          console.log('[/api/offices] Found server:', serverData.id);

          server = {
            id: serverData.id,
            username: serverData.username || 'root',
            ip: serverData.ip,
            cpu: serverData.cpu,
            ram: serverData.ram,
            storage: serverData.storage,
            isPurchased: serverData.is_purchased,
          };

          if (serverData.ip && serverData.password) {
            try {
              console.log('[/api/offices] Fetching OpenClaw config via SSH...');
              config = await fetchOpenClawConfig(serverData.ip, serverData.password, serverData.username || 'root');
              console.log('[/api/offices] OpenClaw config fetched, agents:', config.agents?.length || 0);
            } catch (sshError) {
              console.error('[/api/offices] SSH error:', sshError);
              config = { agents: [], error: 'Failed to connect to server' };
            }
          } else {
            config = { agents: [], error: 'Server not configured' };
          }
        } catch (serverError: any) {
          console.error('[/api/offices] Error fetching server:', serverError);
          server = null;
          config = { agents: [], error: 'Server not found' };
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
          created: office.created,
          updated: office.updated,
        },
        server,
        config,
      });
    } catch (pbError: any) {
      console.log('[/api/offices] DB error:', pbError.status, pbError.message);
      if (pbError.status === 404) {
        return res.json({ success: true, hasOffice: false, office: null, server: null, config: null });
      }
      throw pbError;
    }
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

    const pb = await getDb();

    const offices = await pb.collection('office').getFullList<OfficeRecord>({
      filter: `user_id="${userId}"`,
      sort: '-created',
      expand: 'server_id',
    });

    res.json({
      success: true,
      data: offices.map((office) => ({
        id: office.id,
        userId: office.user_id,
        serverId: office.server_id,
        expiredAt: office.expired_at,
        created: office.created,
        updated: office.updated,
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

    const pb = await getDb();

    const office = await pb.collection('office').create<OfficeRecord>({
      user_id: userId,
      server_id: serverId,
      expired_at: expiredAt || null,
    });

    res.json({
      success: true,
      office: {
        id: office.id,
        userId: office.user_id,
        serverId: office.server_id,
        expiredAt: office.expired_at,
        created: office.created,
        updated: office.updated,
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
