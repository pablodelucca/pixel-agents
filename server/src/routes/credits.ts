import { Router } from 'express';
import PocketBase from 'pocketbase';

export const creditsRoutes = Router();

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
    console.log('[PocketBase/Credits] Authenticating as admin...');
    try {
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      // Set expiry to 50 minutes from now (tokens usually last 1 hour)
      adminAuthExpiry = now + 50 * 60 * 1000;
      console.log('[PocketBase/Credits] Admin authenticated successfully');
    } catch (err) {
      console.error('[PocketBase/Credits] Failed to authenticate as admin:', err);
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
 * GET /api/credits
 * Get or create credit balance for user
 * - If credit record exists, return balance
 * - If not, create a new record with balance 0 and return it
 */
creditsRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);

    console.log('[/api/credits] Fetching credits for userId:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getPbAdminClient();

    // Try to find existing credit record
    try {
      const credit = await pb.collection('credit').getFirstListItem(
        `user_id="${userId}"`,
      );

      console.log('[/api/credits] Found existing credit record:', credit.id);

      res.json({
        success: true,
        balance: credit.balance || 0,
      });
    } catch (pbError: any) {
      // Record not found - create new one
      if (pbError.status === 404) {
        console.log('[/api/credits] No credit record found, creating new one for user:', userId);

        const newCredit = await pb.collection('credit').create({
          user_id: userId,
          balance: 0,
        });

        console.log('[/api/credits] Created new credit record:', newCredit.id);

        res.json({
          success: true,
          balance: newCredit.balance || 0,
        });
      } else {
        throw pbError;
      }
    }
  } catch (error) {
    console.error('Error fetching credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/credits
 * Create a new credit record manually (optional - usually auto-created on first fetch)
 */
creditsRoutes.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { balance = 0 } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getPbAdminClient();

    // Check if credit record already exists
    const existingCredit = await pb.collection('credit').getFirstListItem(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (existingCredit) {
      return res.status(400).json({
        success: false,
        error: 'Credit record already exists for this user',
        balance: existingCredit.balance || 0,
      });
    }

    // Create new credit record
    const credit = await pb.collection('credit').create({
      user_id: userId,
      balance: balance,
    });

    res.json({
      success: true,
      balance: credit.balance || 0,
    });
  } catch (error) {
    console.error('Error creating credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/credits
 * Update credit balance (e.g., after top-up or deduction)
 */
creditsRoutes.put('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { balance } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    if (typeof balance !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Balance must be a number',
      });
    }

    const pb = await getPbAdminClient();

    // Find existing credit record
    const credit = await pb.collection('credit').getFirstListItem(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (!credit) {
      return res.status(404).json({
        success: false,
        error: 'Credit record not found',
      });
    }

    // Update balance
    await pb.collection('credit').update(credit.id, {
      balance: balance,
    });

    res.json({
      success: true,
      balance: balance,
    });
  } catch (error) {
    console.error('Error updating credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/credits/add
 * Add amount to current balance (positive for top-up, negative for deduction)
 */
creditsRoutes.post('/add', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { amount } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    if (typeof amount !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a number',
      });
    }

    const pb = await getPbAdminClient();

    // Find existing credit record
    let credit = await pb.collection('credit').getFirstListItem(
      `user_id="${userId}"`,
    ).catch(() => null);

    // If no record exists, create one first
    if (!credit) {
      credit = await pb.collection('credit').create({
        user_id: userId,
        balance: 0,
      });
    }

    // Ensure credit exists after creation
    if (!credit) {
      res.status(500).json({ error: 'Failed to create credit record' });
      return;
    }

    // Calculate new balance
    const currentBalance = credit.balance || 0;
    const newBalance = currentBalance + amount;

    // Update balance
    await pb.collection('credit').update(credit.id, {
      balance: newBalance,
    });

    res.json({
      success: true,
      balance: newBalance,
    });
  } catch (error) {
    console.error('Error adding credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
