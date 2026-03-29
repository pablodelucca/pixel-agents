import { Router } from 'express';
import PocketBase from 'pocketbase';

export const paymentHistoryRoutes = Router();

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
    console.log('[PocketBase/PaymentHistory] Authenticating as admin...');
    try {
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      adminAuthExpiry = now + 50 * 60 * 1000;
      console.log('[PocketBase/PaymentHistory] Admin authenticated successfully');
    } catch (err) {
      console.error('[PocketBase/PaymentHistory] Failed to authenticate as admin:', err);
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
 * GET /api/history/payment
 * Get payment history for user
 */
paymentHistoryRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);

    console.log('[/api/history/payment] Fetching payment history for userId:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getPbAdminClient();

    // Fetch all payments for this user, sorted by newest first
    const payments = await pb.collection('payment').getFullList({
      filter: `user_id="${userId}"`,
      sort: '-created',
    });

    console.log('[/api/history/payment] Found', payments.length, 'payments for user:', userId);

    res.json({
      success: true,
      data: payments.map((payment) => ({
        id: payment.id,
        userId: payment.user_id,
        amount: payment.amount,
        status: payment.status,
        url: payment.url,
        metadata: payment.metadata,
        created: payment.created,
        updated: payment.updated,
      })),
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
