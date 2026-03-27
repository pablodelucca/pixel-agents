import { Router } from 'express';
import PocketBase from 'pocketbase';

import { fetchSessionHistory, listSessions, sendMessageToAgent } from '../services/ssh.js';

// mergeParams: true to access :serverId from parent router
export const sessionsRoutes = Router({ mergeParams: true });

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

// Type for request params with merged parent params
interface SessionParams {
  serverId: string;
}

interface SessionParamsWithId extends SessionParams {
  sessionId: string;
}

/**
 * GET /api/servers/:serverId/sessions
 * List all sessions for an agent on a server
 */
sessionsRoutes.get('/', async (req, res) => {
  try {
    const { serverId } = req.params as SessionParams;
    const agentId = (req.query.agentId as string) || 'main';

    const pb = await getPbAdminClient();
    const server = await pb.collection('server').getOne(serverId).catch(() => null);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.ip) {
      return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    }

    if (!server.password) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    const sshUser = server.username ?? 'root';
    const sshPort = 22;

    // Fetch sessions list
    const sessions = await listSessions(server.ip, server.password, agentId, sshUser, sshPort);

    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/servers/:serverId/sessions/:sessionId
 * Get session history (chat messages)
 */
sessionsRoutes.get('/:sessionId', async (req, res) => {
  try {
    const { serverId, sessionId } = req.params as SessionParamsWithId;
    const agentId = (req.query.agentId as string) || 'main';

    const pb = await getPbAdminClient();
    const server = await pb.collection('server').getOne(serverId).catch(() => null);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.ip) {
      return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    }

    if (!server.password) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    const sshUser = server.username ?? 'root';
    const sshPort = 22;

    // Fetch session history
    const session = await fetchSessionHistory(
      server.ip,
      server.password,
      sessionId,
      agentId,
      sshUser,
      sshPort,
    );

    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error fetching session history:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/servers/:serverId/sessions/:sessionId/messages
 * Send a message to the agent via OpenClaw CLI
 */
sessionsRoutes.post('/:sessionId/messages', async (req, res) => {
  try {
    const { serverId, sessionId } = req.params as SessionParamsWithId;
    const { content, agentId = 'main' } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'Message content is required' });
    }

    const pb = await getPbAdminClient();
    const server = await pb.collection('server').getOne(serverId).catch(() => null);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.ip) {
      return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    }

    if (!server.password) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    const sshUser = server.username ?? 'root';
    const sshPort = 22;

    // Send message to OpenClaw agent
    const result = await sendMessageToAgent(
      server.ip,
      server.password,
      sessionId,
      content,
      agentId,
      sshUser,
      sshPort,
    );

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
