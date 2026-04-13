import { Router } from 'express';

import type { CreditRecord, OfficeRecord, ServerRecord, TransactionRecord } from '../../src/shared/index.js';
import { getUserIdFromRequest, PACKAGE_SPECS } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';
import { fetchOpenClawConfig, checkServerConnection } from '../services/ssh.js';
import { sessionsRoutes } from './sessions.js';

export const serverRoutes = Router();

// Reservation timeout (5 minutes)
const RESERVATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Get available server including expired reservations
 */
async function getAvailableServer(
  db: any,
  spec: { cpu: number; ram: number; storage: number },
): Promise<ServerRecord | null> {
  const timeoutDate = new Date(Date.now() - RESERVATION_TIMEOUT_MS).toISOString();

  // Try available servers first
  const { data: availableServers } = await db
    .from('servers')
    .select('*')
    .eq('status', 'available')
    .eq('cpu', spec.cpu)
    .eq('ram', spec.ram)
    .eq('storage', spec.storage)
    .order('created_at', { ascending: true });

  if (availableServers && availableServers.length > 0) {
    console.log(`[getAvailableServer] Found ${availableServers.length} available servers`);
    return availableServers[0];
  }

  // Check for expired reservations
  const { data: reservedServers } = await db
    .from('servers')
    .select('*')
    .eq('status', 'reserved')
    .eq('cpu', spec.cpu)
    .eq('ram', spec.ram)
    .eq('storage', spec.storage)
    .order('created_at', { ascending: true });

  if (reservedServers) {
    for (const server of reservedServers) {
      if (server.updated_at) {
        const updatedAt = new Date(server.updated_at);
        if (updatedAt <= new Date(timeoutDate)) {
          console.log(`[getAvailableServer] Found expired reservation: ${server.id}`);
          return server;
        }
      }
    }
  }

  return null;
}

/**
 * GET /api/servers
 */
serverRoutes.get('/', async (_req, res) => {
  try {
    const db = getDb();
    const { data: servers, error } = await db
      .from('servers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const safeServers = (servers || []).map(({ password, ...server }: ServerRecord) => server);
    res.json({ success: true, data: safeServers });
  } catch (error) {
    console.error('Error fetching servers:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/servers/availability
 */
serverRoutes.get('/availability', async (_req, res) => {
  try {
    const db = getDb();
    const availability: Record<string, { available: number; spec: { cpu: number; ram: number; storage: number } }> = {};

    for (const [packageName, spec] of Object.entries(PACKAGE_SPECS)) {
      const { count, error } = await db
        .from('servers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'available')
        .eq('cpu', spec.cpu)
        .eq('ram', spec.ram)
        .eq('storage', spec.storage);

      if (error) throw new Error(error.message);
      availability[packageName] = { available: count || 0, spec };
    }

    res.json({
      success: true,
      data: {
        total: Object.values(availability).reduce((sum, pkg) => sum + pkg.available, 0),
        packages: availability,
      },
    });
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/servers/reserve
 */
serverRoutes.post('/reserve', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { packageType } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });
    }

    console.log(`[/api/servers/reserve] User ${userId} reserving ${packageType}`);

    const db = getDb();
    const spec = PACKAGE_SPECS[packageType] || PACKAGE_SPECS.business;
    const server = await getAvailableServer(db, spec);

    if (!server) {
      return res.status(400).json({
        success: false,
        error: `No ${packageType} offices available. Try a different package or check back later!`,
        code: 'NO_AVAILABILITY',
      });
    }

    const { data: updatedServer, error } = await db
      .from('servers')
      .update({ status: 'reserved' })
      .eq('id', server.id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      data: {
        serverId: updatedServer.id,
        reservedAt: updatedServer.updated_at,
        packageType: packageType || 'business',
      },
    });
  } catch (error) {
    console.error('Error reserving server:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/servers/confirm-purchase
 */
serverRoutes.post('/confirm-purchase', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { serverId } = req.body;

    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });
    if (!serverId) return res.status(400).json({ success: false, error: 'Server ID is required' });

    console.log(`[/api/servers/confirm-purchase] Confirming rental for ${serverId}`);

    const db = getDb();

    const { data: server, error: serverError } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (serverError) throw new Error(serverError.message);
    if (!server) return res.status(404).json({ success: false, error: 'Office not found' });
    if (server.status !== 'reserved') return res.status(400).json({ success: false, error: 'Office is not reserved', code: 'NOT_RESERVED' });

    const timeoutDate = new Date(Date.now() - RESERVATION_TIMEOUT_MS);
    if (new Date(server.updated_at) <= timeoutDate) {
      return res.status(400).json({ success: false, error: 'Reservation has expired. Please try again.', code: 'RESERVATION_EXPIRED' });
    }

    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + 30);

    await db.from('servers').update({ status: 'occupied' }).eq('id', serverId);

    try {
      const { data: office, error: officeError } = await db
        .from('offices')
        .insert({
          user_id: userId,
          server_id: serverId,
          expired_at: expiredAt.toISOString(),
        })
        .select()
        .single();

      if (officeError) throw officeError;

      res.json({
        success: true,
        data: { serverId, officeId: office.id, expiredAt: expiredAt.toISOString(), message: 'Office rental confirmed successfully' },
      });
    } catch (createError) {
      res.json({
        success: true,
        data: { serverId, officeId: null, expiredAt: expiredAt.toISOString(), message: 'Office rental confirmed, but failed to create office record', warning: createError instanceof Error ? createError.message : 'Unknown error' },
      });
    }
  } catch (error) {
    console.error('Error confirming purchase:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/servers/cancel-reservation
 */
serverRoutes.post('/cancel-reservation', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { serverId } = req.body;

    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });
    if (!serverId) return res.status(400).json({ success: false, error: 'Server ID is required' });

    const db = getDb();

    const { data: server, error: serverError } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (serverError) throw new Error(serverError.message);
    if (!server) return res.status(404).json({ success: false, error: 'Office not found' });

    if (server.status !== 'reserved') {
      return res.json({ success: true, message: 'Reservation already released' });
    }

    await db.from('servers').update({ status: 'available' }).eq('id', serverId);
    res.json({ success: true, message: 'Reservation cancelled' });
  } catch (error) {
    console.error('Error cancelling reservation:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/servers/:id
 */
serverRoutes.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });

    const { password, ...safeServer } = server;
    res.json({ success: true, data: safeServer });
  } catch (error) {
    console.error('Error fetching server:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/servers/:id/config
 */
serverRoutes.get('/:id/config', async (req, res) => {
  try {
    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (!server.ip_public) return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    if (!server.password) return res.status(400).json({ success: false, error: 'Server has no password configured' });

    const config = await fetchOpenClawConfig(server.ip_public, server.password, server.username || 'root');
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('Error fetching server config:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/servers/:id/test
 */
serverRoutes.get('/:id/test', async (req, res) => {
  try {
    const db = getDb();
    const { data: server, error } = await db
      .from('servers')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });

    const isConnected = await checkServerConnection(server.ip_public, server.password, server.username || 'root');

    res.json({ success: true, data: { connected: isConnected, host: server.ip_public, user: server.username || 'root' } });
  } catch (error) {
    console.error('Error testing server connection:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * PUT /api/servers/:id/password (DEV ONLY)
 */
serverRoutes.put('/:id/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || typeof password !== 'string') return res.status(400).json({ success: false, error: 'Password is required' });

    const db = getDb();
    const { data: server, error: serverError } = await db
      .from('servers')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (serverError) throw new Error(serverError.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });

    await db.from('servers').update({ password }).eq('id', server.id);
    res.json({ success: true, message: `Password updated for server "${server.username || server.id}"`, data: { id: server.id, password_set: true } });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/servers/purchase-with-rupiah
 */
serverRoutes.post('/purchase-with-rupiah', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { serverId, packageType, packageName, priceRupiah } = req.body;

    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });
    if (!serverId) return res.status(400).json({ success: false, error: 'Server ID is required' });
    if (!priceRupiah || typeof priceRupiah !== 'number' || priceRupiah <= 0) return res.status(400).json({ success: false, error: 'Invalid price' });

    console.log(`[/api/servers/purchase-with-rupiah] User ${userId} purchasing ${packageType} server ${serverId} for Rp ${priceRupiah}`);

    const db = getDb();

    const { data: server, error: serverError } = await db
      .from('servers')
      .select('*')
      .eq('id', serverId)
      .maybeSingle();

    if (serverError) throw new Error(serverError.message);
    if (!server) return res.status(404).json({ success: false, error: 'Server not found' });
    if (server.status !== 'reserved') return res.status(400).json({ success: false, error: 'Server is not reserved', code: 'NOT_RESERVED' });

    const timeoutDate = new Date(Date.now() - RESERVATION_TIMEOUT_MS);
    if (new Date(server.updated_at) <= timeoutDate) {
      return res.status(400).json({ success: false, error: 'Reservation has expired. Please try again.', code: 'RESERVATION_EXPIRED' });
    }

    // Get user credits
    const { data: credit } = await db
      .from('credits')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!credit) {
      return res.status(400).json({ success: false, error: 'Insufficient credits. Please top up first.', code: 'INSUFFICIENT_CREDITS', currentBalance: 0, requiredAmount: priceRupiah });
    }

    const currentBalance = credit.balance || 0;

    if (currentBalance < priceRupiah) {
      return res.status(400).json({
        success: false,
        error: `Insufficient credits. You have Rp ${currentBalance.toLocaleString('id-ID')}, need Rp ${priceRupiah.toLocaleString('id-ID')}.`,
        code: 'INSUFFICIENT_CREDITS',
        currentBalance,
        requiredAmount: priceRupiah,
      });
    }

    // Deduct credits
    const newBalance = currentBalance - priceRupiah;
    await db.from('credits').update({ balance: newBalance }).eq('id', credit.id);

    // Create transaction record
    await db.from('transactions').insert({
      user_id: userId,
      type: 'CREDIT',
      amount: priceRupiah,
      description: `Purchase ${packageName || packageType} Server`,
      ref: serverId,
    });

    // Update server status
    await db.from('servers').update({ status: 'occupied' }).eq('id', serverId);

    // Create office
    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + 30);

    const { data: office, error: officeError } = await db
      .from('offices')
      .insert({
        user_id: userId,
        server_id: serverId,
        expired_at: expiredAt.toISOString(),
      })
      .select()
      .single();

    if (officeError) throw new Error(officeError.message);

    console.log(`[/api/servers/purchase-with-rupiah] Office ${office.id} created for user ${userId}`);

    res.json({
      success: true,
      data: { serverId, officeId: office.id, expiredAt: expiredAt.toISOString(), newBalance, message: 'Server purchased successfully' },
    });
  } catch (error) {
    console.error('Error purchasing server with rupiah:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Nested sessions routes
serverRoutes.use('/:id/sessions', sessionsRoutes);
