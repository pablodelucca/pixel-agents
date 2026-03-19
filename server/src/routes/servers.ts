import { Router } from 'express';

import { getServerById, getServersByUserId, updateServer } from '../services/database.js';
import { fetchOpenClawConfig, checkServerConnection } from '../services/ssh.js';
import { decryptPassword, encryptPassword } from '../utils/crypto.js';

export const serverRoutes = Router();

/**
 * Middleware to extract user ID from request
 * In production, this should validate a JWT token from Supabase Auth
 */
function getUserId(_req: import('express').Request): string | null {
  // TODO: Implement proper auth validation
  // For now, we'll use a header or query param for testing
  // In production, extract from JWT token in Authorization header
  return null;
}

/**
 * GET /api/servers
 * List all servers for the authenticated user
 */
serverRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      // For development: return all servers (remove in production!)
      if (process.env.NODE_ENV === 'development') {
        const { getSupabase } = await import('../services/database.js');
        const { data, error } = await getSupabase().from('servers').select('*');
        if (error) throw error;
        return res.json({ success: true, data });
      }
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const servers = await getServersByUserId(userId);
    res.json({ success: true, data: servers });
  } catch (error) {
    console.error('Error fetching servers:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/servers/:id
 * Get a single server by ID
 */
serverRoutes.get('/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const server = await getServerById(req.params.id, userId ?? undefined);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Remove sensitive data before sending
    const { password_encrypted, ...safeServer } = server;
    res.json({ success: true, data: safeServer });
  } catch (error) {
    console.error('Error fetching server:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/servers/:id/config
 * Fetch OpenClaw config from a server via SSH
 */
serverRoutes.get('/:id/config', async (req, res) => {
  try {
    const userId = getUserId(req);
    const server = await getServerById(req.params.id, userId ?? undefined);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.public_ip) {
      return res.status(400).json({ success: false, error: 'Server has no public IP' });
    }

    if (!server.password_encrypted) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    // Decrypt password
    const password = decryptPassword(server.password_encrypted);
    const sshUser = server.ssh_user ?? 'root';
    const sshPort = server.ssh_port ?? 22;

    // Fetch OpenClaw config
    const config = await fetchOpenClawConfig(server.public_ip, password, sshUser, sshPort);

    res.json({ success: true, data: config });
  } catch (error) {
    console.error('Error fetching server config:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/servers/:id/test
 * Test SSH connection to a server
 */
serverRoutes.get('/:id/test', async (req, res) => {
  try {
    const userId = getUserId(req);
    const server = await getServerById(req.params.id, userId ?? undefined);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.public_ip) {
      return res.status(400).json({ success: false, error: 'Server has no public IP' });
    }

    if (!server.password_encrypted) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    // Decrypt password
    const password = decryptPassword(server.password_encrypted);
    const sshUser = server.ssh_user ?? 'root';
    const sshPort = server.ssh_port ?? 22;

    // Test connection
    const isConnected = await checkServerConnection(server.public_ip, password, sshUser, sshPort);

    res.json({
      success: true,
      data: {
        connected: isConnected,
        host: server.public_ip,
        port: sshPort,
        user: sshUser,
      },
    });
  } catch (error) {
    console.error('Error testing server connection:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/servers/:id/execute
 * Execute a command on a server via SSH
 * (Optional - for future use)
 */
serverRoutes.post('/:id/execute', async (req, res) => {
  try {
    const { command } = req.body;

    if (!command || typeof command !== 'string') {
      return res.status(400).json({ success: false, error: 'Command is required' });
    }

    const userId = getUserId(req);
    const server = await getServerById(req.params.id, userId ?? undefined);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.public_ip) {
      return res.status(400).json({ success: false, error: 'Server has no public IP' });
    }

    if (!server.password_encrypted) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    // Decrypt password
    const password = decryptPassword(server.password_encrypted);
    const sshUser = server.ssh_user ?? 'root';
    const sshPort = server.ssh_port ?? 22;

    // Execute command
    const { executeRemoteCommand } = await import('../services/ssh.js');
    const output = await executeRemoteCommand(server.public_ip, password, command, sshUser, sshPort);

    res.json({ success: true, data: { output } });
  } catch (error) {
    console.error('Error executing command:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/servers/:id/password
 * Update server password (will be encrypted)
 * DEV ONLY - Remove in production!
 */
serverRoutes.put('/:id/password', async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }

    const userId = getUserId(req);
    const server = await getServerById(req.params.id, userId ?? undefined);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Encrypt password
    const encryptedPassword = encryptPassword(password);

    // Update server with encrypted password
    await updateServer(server.id, {
      password_encrypted: encryptedPassword,
      password_key_version: 1,
    }, userId ?? undefined);

    res.json({
      success: true,
      message: `Password updated for server "${server.name}"`,
      data: {
        id: server.id,
        name: server.name,
        password_set: true,
      },
    });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
