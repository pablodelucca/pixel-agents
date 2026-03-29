import { Router } from 'express';
import PocketBase from 'pocketbase';

export const transactionHistoryRoutes = Router();

// PocketBase connection
const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'admin@example.com';
const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || 'admin123';

// Cache for PocketBase admin client
let pbAdmin: PocketBase | null = null;
let adminAuthExpiry = 0;

async function getPbAdminClient(): Promise<PocketBase> {
  const pb = new PocketBase(POCKETBASE_URL);

  const now = Date.now();
  if (!pbAdmin || adminAuthExpiry < now) {
    console.log('[PocketBase/TransactionHistory] Authenticating as admin...');
    try {
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      adminAuthExpiry = now + 50 * 60 * 1000;
      console.log('[PocketBase/TransactionHistory] Admin authenticated successfully');
    } catch (err) {
      console.error('[PocketBase/TransactionHistory] Failed to authenticate as admin:', err);
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
 * GET /api/history/transaction
 * Get transaction history for user
 */
transactionHistoryRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);

    console.log('[/api/history/transaction] Fetching transaction history for userId:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getPbAdminClient();

    // Fetch all transactions for this user, sorted by newest first
    const transactions = await pb.collection('transaction').getFullList({
      filter: `user_id="${userId}"`,
      sort: '-created',
    });

    console.log('[/api/history/transaction] Found', transactions.length, 'transactions for user:', userId);

    res.json({
      success: true,
      data: transactions.map((transaction) => ({
        id: transaction.id,
        userId: transaction.user_id,
        desc: transaction.desc,
        type: transaction.type,
        amount: transaction.amount,
        created: transaction.created,
        updated: transaction.updated,
      })),
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
