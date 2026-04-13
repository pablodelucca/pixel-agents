import { Router } from 'express';

import type { ServerRecord } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';
import {
  createNewSession,
  fetchAgentWorkspace,
  fetchSessionHistory,
  listSessions,
  saveAgentWorkspaceFile,
  sendMessageToAgent,
} from '../services/ssh.js';

// mergeParams: true to access :serverId from parent router
export const sessionsRoutes = Router({ mergeParams: true });

interface SessionParams {
  id: string; // serverId from parent route
}

interface SessionParamsWithId extends SessionParams {
  sessionId: string;
}

/**
 * GET /api/servers/:id/sessions
 */
sessionsRoutes.get('/', async (req, res) => {
  try {
    const { id: serverId } = req.params as SessionParams;
    const agentId = (req.query.agentId as string) || 'main';

    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (!server.ip) return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    if (!server.password) return res.status(400).json({ success: false, error: 'Server has no password configured' });

    const sessions = await listSessions(server.ip, server.password, agentId, server.username ?? 'root', 22);
    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/servers/:id/sessions
 */
sessionsRoutes.post('/', async (req, res) => {
  try {
    const { id: serverId } = req.params as SessionParams;
    const { agentId = 'main', initialMessage = 'Hello' } = req.body;

    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (!server.ip) return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    if (!server.password) return res.status(400).json({ success: false, error: 'Server has no password configured' });

    const result = await createNewSession(server.ip, server.password, agentId, initialMessage, server.username ?? 'root', 22);

    if (!result.success) return res.status(500).json({ success: false, error: result.error });

    res.json({ success: true, data: { sessionId: result.sessionId, response: result.response } });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/servers/:id/sessions/workspace
 */
sessionsRoutes.get('/workspace', async (req, res) => {
  try {
    const { id: serverId } = req.params as SessionParams;
    const agentId = (req.query.agentId as string) || 'main';

    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (!server.ip) return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    if (!server.password) return res.status(400).json({ success: false, error: 'Server has no password configured' });

    const result = await fetchAgentWorkspace(server.ip, server.password, agentId, server.username ?? 'root', 22);

    if (!result.success) return res.status(500).json({ success: false, error: result.error });

    res.json({ success: true, data: result.files });
  } catch (error) {
    console.error('Error fetching workspace:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * PUT /api/servers/:id/sessions/workspace
 */
sessionsRoutes.put('/workspace', async (req, res) => {
  try {
    const { id: serverId } = req.params as SessionParams;
    const { filename, content, agentId = 'main' } = req.body;

    if (!filename || typeof filename !== 'string') return res.status(400).json({ success: false, error: 'Filename is required' });
    if (typeof content !== 'string') return res.status(400).json({ success: false, error: 'Content must be a string' });

    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (!server.ip) return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    if (!server.password) return res.status(400).json({ success: false, error: 'Server has no password configured' });

    const result = await saveAgentWorkspaceFile(server.ip, server.password, filename, content, agentId, server.username ?? 'root', 22);

    if (!result.success) return res.status(500).json({ success: false, error: result.error });

    res.json({ success: true, message: `${filename} saved successfully` });
  } catch (error) {
    console.error('Error saving workspace file:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/servers/:id/sessions/:sessionId
 */
sessionsRoutes.get('/:sessionId', async (req, res) => {
  try {
    const { id: serverId, sessionId } = req.params as SessionParamsWithId;
    const agentId = (req.query.agentId as string) || 'main';

    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (!server.ip) return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    if (!server.password) return res.status(400).json({ success: false, error: 'Server has no password configured' });

    const session = await fetchSessionHistory(server.ip, server.password, sessionId, agentId, server.username ?? 'root', 22);
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error fetching session history:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/servers/:id/sessions/:sessionId/messages
 */
sessionsRoutes.post('/:sessionId/messages', async (req, res) => {
  try {
    const { id: serverId, sessionId } = req.params as SessionParamsWithId;
    const { content, agentId = 'main' } = req.body;

    if (!content || typeof content !== 'string') return res.status(400).json({ success: false, error: 'Message content is required' });

    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (!server.ip) return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    if (!server.password) return res.status(400).json({ success: false, error: 'Server has no password configured' });

    const result = await sendMessageToAgent(server.ip, server.password, sessionId, content, agentId, server.username ?? 'root', 22);

    if (!result.success) return res.status(500).json({ success: false, error: result.error });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
