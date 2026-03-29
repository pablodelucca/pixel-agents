import { Router } from 'express';
import PocketBase from 'pocketbase';

import { fetchOpenClawConfig, checkServerConnection } from '../services/ssh.js';
import { sessionsRoutes } from './sessions.js';

export const serverRoutes = Router();

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
 */
function normalizeUserId(userId: string): string {
  const PRIVY_PREFIX = 'did:privy:';
  if (userId.startsWith(PRIVY_PREFIX)) {
    return userId.slice(PRIVY_PREFIX.length);
  }
  return userId;
}

/**
 * Get user ID from request (header or query)
 */
function getUserId(req: import('express').Request): string | null {
  const userIdHeader = req.headers['x-user-id'];
  if (typeof userIdHeader === 'string' && userIdHeader) {
    return normalizeUserId(userIdHeader);
  }

  const userIdQuery = req.query.userId;
  if (typeof userIdQuery === 'string' && userIdQuery) {
    return normalizeUserId(userIdQuery);
  }

  return null;
}

/**
 * GET /api/servers
 * List all servers (admin only - or filtered by user)
 */
serverRoutes.get('/', async (req, res) => {
  try {
    const pb = await getPbAdminClient();
    const servers = await pb.collection('server').getFullList({
      sort: '-created',
    });

    // Remove passwords before sending
    const safeServers = servers.map(({ password, ...server }) => server);

    res.json({ success: true, data: safeServers });
  } catch (error) {
    console.error('Error fetching servers:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Reservation timeout in milliseconds (5 minutes - matches frontend countdown)
const RESERVATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Get available servers including expired reservations
 * Returns servers that are either:
 * 1. status="available", OR
 * 2. status="reserved" AND updated > 5 minutes ago (expired reservation)
 */
async function getAvailableServer(
  pb: PocketBase,
  spec: { cpu: number; ram: number; storage: number }
): Promise<{ id: string; [key: string]: any } | null> {
  const timeoutDate = new Date(Date.now() - RESERVATION_TIMEOUT_MS).toISOString();
  
  // First, try to find simply available servers
  const baseSpec = `cpu=${spec.cpu} && ram=${spec.ram} && storage=${spec.storage}`;
  const availableServers = await pb.collection('server').getFullList({
    filter: `status="available" && ${baseSpec}`,
    sort: 'created',
  });

  if (availableServers.length > 0) {
    console.log(`[getAvailableServer] Found ${availableServers.length} available servers`);
    return availableServers[0];
  }

  // If no available servers, check for expired reservations using 'updated' field
  const reservedServers = await pb.collection('server').getFullList({
    filter: `status="reserved" && ${baseSpec}`,
    sort: 'created',
  });

  for (const server of reservedServers) {
    // Use 'updated' field - auto-updated when row changes
    if (server.updated) {
      const updatedAt = new Date(server.updated);
      if (updatedAt <= new Date(timeoutDate)) {
        console.log(`[getAvailableServer] Found expired reservation: ${server.id}, updated: ${server.updated}`);
        return server;
      } else {
        console.log(`[getAvailableServer] Reservation ${server.id} still valid, updated: ${server.updated}`);
      }
    }
  }

  console.log(`[getAvailableServer] No available servers found`);
  return null;
}

/**
 * GET /api/servers/availability
 * Check how many servers are available for each package
 */
serverRoutes.get('/availability', async (req, res) => {
  try {
    const pb = await getPbAdminClient();
    
    // Define specs for each package type
    const packageSpecs = {
      starter: { cpu: 2, ram: 2, storage: 40 },
      business: { cpu: 2, ram: 4, storage: 60 },
      enterprise: { cpu: 2, ram: 8, storage: 80 },
    };

    // Get availability for each package
    const availability: Record<string, { available: number; spec: { cpu: number; ram: number; storage: number } }> = {};
    
    for (const [packageName, spec] of Object.entries(packageSpecs)) {
      // Count available servers (simple filter, no complex OR logic)
      const servers = await pb.collection('server').getFullList({
        filter: `status="available" && cpu=${spec.cpu} && ram=${spec.ram} && storage=${spec.storage}`,
      });
      
      availability[packageName] = {
        available: servers.length,
        spec,
      };
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
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/servers/reserve
 * Check availability and reserve a server for purchase
 * Returns reserved server ID or error if no servers available
 */
serverRoutes.post('/reserve', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { packageType } = req.body; // 'starter', 'business', 'enterprise'

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    console.log(`[/api/servers/reserve] User ${userId} reserving ${packageType} office`);

    const pb = await getPbAdminClient();

    // Define specs for each package type
    const packageSpecs: Record<string, { cpu: number; ram: number; storage: number }> = {
      starter: { cpu: 2, ram: 2, storage: 40 },
      business: { cpu: 2, ram: 4, storage: 60 },
      enterprise: { cpu: 2, ram: 8, storage: 80 },
    };

    // Get spec for selected package (default to business if not found)
    const spec = packageSpecs[packageType] || packageSpecs.business;

    // Find an available office matching the package spec
    // Includes servers with expired reservations (>5 minutes old)
    const server = await getAvailableServer(pb, spec);

    if (!server) {
      console.log(`[/api/servers/reserve] No available ${packageType} offices (${spec.cpu} vCPU, ${spec.ram}GB RAM, ${spec.storage}GB)`);
      return res.status(400).json({
        success: false,
        error: `No ${packageType} offices available with those specs. Try a different package or check back later!`,
        code: 'NO_AVAILABILITY',
      });
    }

    console.log(`[/api/servers/reserve] Found office ${server.id}, reserving...`);

    // Update office status to reserved (only status field - updated will auto-change)
    const updatedServer = await pb.collection('server').update(server.id, {
      status: 'reserved',
    });

    console.log(`[/api/servers/reserve] Office ${server.id} reserved for user ${userId}`);

    res.json({
      success: true,
      data: {
        serverId: updatedServer.id,
        reservedAt: updatedServer.updated, // Use updated field as reserved time
        packageType: packageType || 'business',
      },
    });
  } catch (error) {
    console.error('Error reserving server:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/servers/confirm-purchase
 * Confirm purchase after successful payment
 * Updates server status to occupied and creates office record
 */
serverRoutes.post('/confirm-purchase', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { serverId, packageType, paymentMethod, txHash } = req.body;

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

    console.log(`[/api/servers/confirm-purchase] Confirming rental for office ${serverId}, user ${userId}`);

    const pb = await getPbAdminClient();

    // Verify office exists and is reserved
    const server = await pb.collection('server').getOne(serverId).catch(() => null);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Office not found',
      });
    }

    if (server.status !== 'reserved') {
      return res.status(400).json({
        success: false,
        error: 'Office is not reserved',
        code: 'NOT_RESERVED',
      });
    }

    // Check if reservation is still valid (within 5 minutes)
    const timeoutDate = new Date(Date.now() - RESERVATION_TIMEOUT_MS);
    const updatedAt = new Date(server.updated);
    
    if (updatedAt <= timeoutDate) {
      return res.status(400).json({
        success: false,
        error: 'Reservation has expired. Please try again.',
        code: 'RESERVATION_EXPIRED',
      });
    }

    // Calculate expiry date (30 days from now)
    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + 30);

    // Update server status to occupied
    await pb.collection('server').update(serverId, {
      status: 'occupied',
    });

    console.log(`[/api/servers/confirm-purchase] Office ${serverId} marked as occupied`);

    // Create office rental record
    try {
      const office = await pb.collection('office').create({
        user_id: userId,
        server_id: serverId,
        expired_at: expiredAt.toISOString(),
      });

      console.log(`[/api/servers/confirm-purchase] Rental record ${office.id} created for user ${userId}`);

      res.json({
        success: true,
        data: {
          serverId,
          officeId: office.id,
          expiredAt: expiredAt.toISOString(),
          message: 'Office rental confirmed successfully',
        },
      });
    } catch (createError) {
      console.error('[/api/servers/confirm-purchase] Failed to create office record:', createError);
      // Still return success since server is occupied, but note the office record issue
      res.json({
        success: true,
        data: {
          serverId,
          officeId: null,
          expiredAt: expiredAt.toISOString(),
          message: 'Office rental confirmed, but failed to create office record',
          warning: createError instanceof Error ? createError.message : 'Unknown error',
        },
      });
    }
  } catch (error) {
    console.error('Error confirming purchase:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/servers/cancel-reservation
 * Cancel a server reservation (if payment fails or user cancels)
 */
serverRoutes.post('/cancel-reservation', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { serverId } = req.body;

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

    console.log(`[/api/servers/cancel-reservation] Cancelling reservation for office ${serverId}`);

    const pb = await getPbAdminClient();

    // Verify office exists and is reserved
    const server = await pb.collection('server').getOne(serverId).catch(() => null);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Office not found',
      });
    }

    // Only allow cancellation if status is reserved
    if (server.status !== 'reserved') {
      console.log(`[/api/servers/cancel-reservation] Office ${serverId} is not in reserved state (current: ${server.status})`);
      return res.json({
        success: true,
        message: 'Reservation already released',
      });
    }

    // Update office status back to available
    await pb.collection('server').update(serverId, {
      status: 'available',
    });

    console.log(`[/api/servers/cancel-reservation] Office ${serverId} is now available`);

    res.json({
      success: true,
      message: 'Reservation cancelled',
    });
  } catch (error) {
    console.error('Error cancelling reservation:', error);
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
    const pb = await getPbAdminClient();
    const server = await pb.collection('server').getOne(req.params.id).catch(() => null);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Remove password before sending
    const { password, ...safeServer } = server;
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
    const pb = await getPbAdminClient();
    const server = await pb.collection('server').getOne(req.params.id).catch(() => null);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.ip) {
      return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    }

    if (!server.password) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    // Fetch OpenClaw config
    const config = await fetchOpenClawConfig(server.ip, server.password, server.username || 'root');

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
    const pb = await getPbAdminClient();
    const server = await pb.collection('server').getOne(req.params.id).catch(() => null);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.ip) {
      return res.status(400).json({ success: false, error: 'Server has no IP configured' });
    }

    if (!server.password) {
      return res.status(400).json({ success: false, error: 'Server has no password configured' });
    }

    // Test connection
    const isConnected = await checkServerConnection(server.ip, server.password, server.username || 'root');

    res.json({
      success: true,
      data: {
        connected: isConnected,
        host: server.ip,
        user: server.username || 'root',
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
 * PUT /api/servers/:id/password
 * Update server password
 * DEV ONLY - Remove in production!
 */
serverRoutes.put('/:id/password', async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }

    const pb = await getPbAdminClient();
    const server = await pb.collection('server').getOne(req.params.id).catch(() => null);

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Update server password
    await pb.collection('server').update(server.id, {
      password: password,
    });

    res.json({
      success: true,
      message: `Password updated for server "${server.username || server.id}"`,
      data: {
        id: server.id,
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

/**
 * POST /api/servers/purchase-with-rupiah
 * Purchase server using credits (Rupiah pricing)
 * Flow:
 * 1. Check user credits
 * 2. If insufficient, return error
 * 3. If sufficient, deduct credits and create transaction (type: CREDIT)
 * 4. Confirm purchase and create office record
 */
serverRoutes.post('/purchase-with-rupiah', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { serverId, packageType, packageName, priceRupiah } = req.body;

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

    if (!priceRupiah || typeof priceRupiah !== 'number' || priceRupiah <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid price',
      });
    }

    console.log(`[/api/servers/purchase-with-rupiah] User ${userId} purchasing ${packageType} server ${serverId} for Rp ${priceRupiah}`);

    const pb = await getPbAdminClient();

    // 1. Verify server exists and is reserved
    const server = await pb.collection('server').getOne(serverId).catch(() => null);

    if (!server) {
      return res.status(404).json({
        success: false,
        error: 'Server not found',
      });
    }

    if (server.status !== 'reserved') {
      return res.status(400).json({
        success: false,
        error: 'Server is not reserved',
        code: 'NOT_RESERVED',
      });
    }

    // Check reservation is still valid (within 5 minutes)
    const timeoutDate = new Date(Date.now() - RESERVATION_TIMEOUT_MS);
    const updatedAt = new Date(server.updated);
    
    if (updatedAt <= timeoutDate) {
      return res.status(400).json({
        success: false,
        error: 'Reservation has expired. Please try again.',
        code: 'RESERVATION_EXPIRED',
      });
    }

    // 2. Check user credits
    let credit = await pb.collection('credit').getFirstListItem(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (!credit) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient credits. Please top up first.',
        code: 'INSUFFICIENT_CREDITS',
        currentBalance: 0,
        requiredAmount: priceRupiah,
      });
    }

    const currentBalance = credit.balance || 0;

    if (currentBalance < priceRupiah) {
      return res.status(400).json({
        success: false,
        error: `Insufficient credits. You have Rp ${currentBalance.toLocaleString('id-ID')}, need Rp ${priceRupiah.toLocaleString('id-ID')}.`,
        code: 'INSUFFICIENT_CREDITS',
        currentBalance: currentBalance,
        requiredAmount: priceRupiah,
      });
    }

    // 3. Deduct credits
    const newBalance = currentBalance - priceRupiah;
    await pb.collection('credit').update(credit.id, {
      balance: newBalance,
    });

    console.log(`[/api/servers/purchase-with-rupiah] Credits deducted: ${currentBalance} -> ${newBalance}`);

    // 4. Create transaction (CREDIT = uang keluar)
    await pb.collection('transaction').create({
      user_id: userId,
      type: 'CREDIT',
      amount: priceRupiah,
      desc: `Purchase ${packageName || packageType} Server`,
      ref: serverId,
    });

    console.log(`[/api/servers/purchase-with-rupiah] Transaction created for server ${serverId}`);

    // 5. Update server status to occupied
    await pb.collection('server').update(serverId, {
      status: 'occupied',
    });

    // 6. Create office rental record
    const expiredAt = new Date();
    expiredAt.setDate(expiredAt.getDate() + 30);

    const office = await pb.collection('office').create({
      user_id: userId,
      server_id: serverId,
      expired_at: expiredAt.toISOString(),
    });

    console.log(`[/api/servers/purchase-with-rupiah] Office ${office.id} created for user ${userId}`);

    res.json({
      success: true,
      data: {
        serverId,
        officeId: office.id,
        expiredAt: expiredAt.toISOString(),
        newBalance: newBalance,
        message: 'Server purchased successfully',
      },
    });
  } catch (error) {
    console.error('Error purchasing server with rupiah:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Nested sessions routes under /api/servers/:id/sessions
serverRoutes.use('/:id/sessions', sessionsRoutes);
