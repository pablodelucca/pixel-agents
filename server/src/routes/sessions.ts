import { Router } from 'express';
import PocketBase from 'pocketbase';

import { createNewSession, fetchAgentWorkspace, fetchSessionHistory, listSessions, sendMessageToAgent } from '../services/ssh.js';

// mergeParams: true to access :serverId from parent router
export const sessionsRoutes = Router({ mergeParams: true });

// PocketBase connection
const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'admin@example.com';
const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || 'admin123';

// Cache for PocketBase admin client with mutex lock
let pbAdmin: PocketBase | null = null;
let adminAuthExpiry = 0;
let authPromise: Promise<PocketBase> | null = null;

async function getPbAdminClient(): Promise<PocketBase> {
  const now = Date.now();
  
  // Return cached client if still valid
  if (pbAdmin && adminAuthExpiry > now) {
    return pbAdmin;
  }

  // If authentication is in progress, wait for it
  if (authPromise) {
    return authPromise;
  }

  // Start authentication
  authPromise = (async () => {
    try {
      console.log('[PocketBase] Authenticating as admin...');
      const pb = new PocketBase(POCKETBASE_URL);
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      adminAuthExpiry = now + 50 * 60 * 1000; // 50 minutes
      console.log('[PocketBase] Admin authenticated successfully');
      return pb;
    } catch (err) {
      console.error('[PocketBase] Failed to authenticate as admin:', err);
      throw new Error('PocketBase admin authentication failed');
    } finally {
      authPromise = null;
    }
  })();

  return authPromise;
}

// Type for request params with merged parent params
// Note: :id comes from parent router (servers.ts: serverRoutes.use('/:id/sessions', sessionsRoutes))
interface SessionParams {
  id: string; // serverId from parent route
}

interface SessionParamsWithId extends SessionParams {
  sessionId: string;
}

/**
 * GET /api/servers/:id/sessions
 * List all sessions for an agent on a server
 */
sessionsRoutes.get('/', async (req, res) => {
  try {
    const { id: serverId } = req.params as SessionParams;
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
 * POST /api/servers/:id/sessions
 * Create a new session for an agent
 */
sessionsRoutes.post('/', async (req, res) => {
  try {
    const { id: serverId } = req.params as SessionParams;
    const { agentId = 'main', initialMessage = 'Hello' } = req.body;

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

    // Create new session
    const result = await createNewSession(
      server.ip,
      server.password,
      agentId,
      initialMessage,
      sshUser,
      sshPort,
    );

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ 
      success: true, 
      data: {
        sessionId: result.sessionId,
        response: result.response,
      }
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/servers/:id/sessions/workspace
 * Fetch agent workspace files (AGENTS.md, IDENTITY.md, SOUL.md, etc.)
 * Returns the 7 markdown files that define the agent's personality and memory
 * 
 * IMPORTANT: This route must be defined BEFORE /:sessionId to avoid route conflicts
 */
sessionsRoutes.get('/workspace', async (req, res) => {
  try {
    const { id: serverId } = req.params as SessionParams;
    const agentId = (req.query.agentId as string) || 'main';

    console.log('[/workspace] Request received:', { serverId, agentId });

    const pb = await getPbAdminClient();
    
    console.log('[/workspace] PocketBase client ready, fetching server...');
    const server = await pb.collection('server').getOne(serverId).catch((err) => {
      console.error('[/workspace] PocketBase error:', err);
      return null;
    });

    console.log('[/workspace] Server lookup result:', server ? `Found ${server.id}` : 'Not found');

    if (!server) {
      console.log('[/workspace] Server not found for ID:', serverId);
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

    // Fetch workspace files
    const result = await fetchAgentWorkspace(
      server.ip,
      server.password,
      agentId,
      sshUser,
      sshPort,
    );

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result.files });
  } catch (error) {
    console.error('Error fetching workspace:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/servers/:id/sessions/:sessionId
 * Get session history (chat messages)
 */
sessionsRoutes.get('/:sessionId', async (req, res) => {
  try {
    const { id: serverId, sessionId } = req.params as SessionParamsWithId;
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
 * POST /api/servers/:id/sessions/:sessionId/messages
 * Send a message to the agent via OpenClaw CLI
 */
sessionsRoutes.post('/:sessionId/messages', async (req, res) => {
  try {
    const { id: serverId, sessionId } = req.params as SessionParamsWithId;
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
