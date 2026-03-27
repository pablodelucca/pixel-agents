import { Router } from 'express';
import PocketBase from 'pocketbase';

import { fetchOpenClawConfig } from '../services/ssh.js';

export const officesRoutes = Router();

// PocketBase connection
const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'admin@example.com';
const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || 'admin123';

// Cache for PocketBase admin client
let pbAdmin: PocketBase | null = null;
let adminAuthExpiry = 0;

async function getPbAdminClient(): Promise<PocketBase> {
  const pb = new PocketBase(POCKETBASE_URL);

  // Check if we need to re-authenticate (token expires after ~1 hour)
  const now = Date.now();
  if (!pbAdmin || adminAuthExpiry < now) {
    console.log('[PocketBase] Authenticating as admin...');
    try {
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      // Set expiry to 50 minutes from now (tokens usually last 1 hour)
      adminAuthExpiry = now + 50 * 60 * 1000;
      console.log('[PocketBase] Admin authenticated successfully');
    } catch (err) {
      console.error('[PocketBase] Failed to authenticate as admin:', err);
      throw new Error('PocketBase admin authentication failed');
    }
  }

  return pbAdmin;
}

/**
 * Normalize user ID - strip 'did:privy:' prefix if present
 * Privy returns: 'did:privy:cmn2s6xm0028b0djuvks8lv19'
 * PocketBase stores: 'cmn2s6xm0028b0djuvks8lv19'
 */
function normalizeUserId(userId: string): string {
  const PRIVY_PREFIX = 'did:privy:';
  if (userId.startsWith(PRIVY_PREFIX)) {
    return userId.slice(PRIVY_PREFIX.length);
  }
  return userId;
}

/**
 * Middleware to extract user ID from request
 * Currently expects userId from query param or header (for development)
 * In production, this should validate a JWT token
 */
function getUserId(req: import('express').Request): string | null {
  // Try header first
  const userIdHeader = req.headers['x-user-id'];
  if (typeof userIdHeader === 'string' && userIdHeader) {
    return normalizeUserId(userIdHeader);
  }

  // Try query param
  const userIdQuery = req.query.userId;
  if (typeof userIdQuery === 'string' && userIdQuery) {
    return normalizeUserId(userIdQuery);
  }

  return null;
}

/**
 * GET /api/offices
 * Check if user has an active office (purchased server)
 * Returns office data and server config if exists, otherwise returns null
 */
officesRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);

    console.log('[/api/offices] Checking office for userId:', userId, '(normalized from header)');

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
        hasOffice: false,
        office: null,
        server: null,
        config: null,
      });
    }

    const pb = await getPbAdminClient();

    try {
      // Find office by user_id
      const office = await pb.collection('office').getFirstListItem(
        `user_id="${userId}"`,
      );

      console.log('[/api/offices] Found office:', office);

      // Check if not expired (if expired_at is set)
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

      // If server_id exists, fetch server data and config
      let server = null;
      let config = null;

      if (office.server_id) {
        try {
          // Fetch server from PocketBase
          const serverData = await pb.collection('server').getOne(office.server_id);
          console.log('[/api/offices] Found server:', serverData.id);

          // Prepare server info (without password)
          server = {
            id: serverData.id,
            username: serverData.username || 'root',
            ip: serverData.ip,
            cpu: serverData.cpu,
            ram: serverData.ram,
            storage: serverData.storage,
            isPurchased: serverData.is_purchased,
          };

          // Fetch OpenClaw config via SSH
          if (serverData.ip && serverData.password) {
            try {
              console.log('[/api/offices] Fetching OpenClaw config via SSH...');
              const openClawConfig = await fetchOpenClawConfig(
                serverData.ip,
                serverData.password,
                serverData.username || 'root',
              );
              config = openClawConfig;
              console.log('[/api/offices] OpenClaw config fetched, agents:', config.agents?.length || 0);
            } catch (sshError) {
              console.error('[/api/offices] SSH error:', sshError);
              // Don't fail the whole request, just return empty config
              config = { agents: [], error: 'Failed to connect to server' };
            }
          } else {
            console.log('[/api/offices] Server missing IP or password');
            config = { agents: [], error: 'Server not configured' };
          }
        } catch (serverError: any) {
          console.error('[/api/offices] Error fetching server:', serverError);
          // Server not found, but office exists
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
      // Record not found - user has no office
      console.log('[/api/offices] PocketBase error:', pbError.status, pbError.message);
      if (pbError.status === 404) {
        return res.json({
          success: true,
          hasOffice: false,
          office: null,
          server: null,
          config: null,
        });
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
 * Get all offices for a user (including expired)
 * DEV ONLY - useful for debugging
 */
officesRoutes.get('/all', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getPbAdminClient();

    const offices = await pb.collection('office').getFullList({
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
 * This is called when a user successfully purchases a server
 */
officesRoutes.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { serverId, expiredAt } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    if (!serverId) {
      return res.status(400).json({
        success: false,
        error: 'Server ID is required',
      });
    }

    const pb = await getPbAdminClient();

    const office = await pb.collection('office').create({
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
