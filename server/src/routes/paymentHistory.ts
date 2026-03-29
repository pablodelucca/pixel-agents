import { Router } from 'express';
import PocketBase from 'pocketbase';
import axios from 'axios';

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
 * Check payment status from Tripay and update if paid
 */
async function checkAndUpdatePaymentStatus(
  pb: PocketBase,
  payment: any,
  userId: string
): Promise<{ updated: boolean; newStatus: string }> {
  // Skip if not UNPAID or no Tripay reference
  if (payment.status !== 'UNPAID') {
    return { updated: false, newStatus: payment.status };
  }

  // Get Tripay reference from metadata
  const tripayRef = payment.metadata?.data?.reference;
  if (!tripayRef) {
    console.log('[checkAndUpdatePaymentStatus] No Tripay reference for payment:', payment.id);
    return { updated: false, newStatus: payment.status };
  }

  const apiKey = process.env.TRIPAY_API_KEY;
  const apiUrl = process.env.TRIPAY_API_URL;

  if (!apiKey || !apiUrl) {
    console.log('[checkAndUpdatePaymentStatus] Tripay not configured');
    return { updated: false, newStatus: payment.status };
  }

  try {
    // Build Tripay API URL for status check
    const baseUrl = apiUrl.replace('/transaction/create', '');
    const checkUrl = `${baseUrl}/transaction/detail?reference=${tripayRef}`;

    console.log('[checkAndUpdatePaymentStatus] Checking Tripay for payment:', payment.id);

    const response = await axios.get(checkUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      validateStatus: (status) => status < 999,
    });

    if (!response.data.success) {
      console.error('[checkAndUpdatePaymentStatus] Tripay error:', response.data);
      return { updated: false, newStatus: payment.status };
    }

    const tripayStatus = response.data.data?.status;
    console.log('[checkAndUpdatePaymentStatus] Tripay status:', tripayStatus, 'for payment:', payment.id);

    // Update if status changed
    if (tripayStatus && tripayStatus !== payment.status) {
      // Update payment status
      await pb.collection('payment').update(payment.id, {
        status: tripayStatus,
        metadata: {
          ...payment.metadata,
          status_check: response.data,
          checked_at: new Date().toISOString(),
        },
      });

      console.log('[checkAndUpdatePaymentStatus] Updated payment', payment.id, 'to', tripayStatus);

      // If PAID, add credits
      if (tripayStatus === 'PAID') {
        let credit = await pb.collection('credit').getFirstListItem(
          `user_id="${userId}"`,
        ).catch(() => null);

        if (!credit) {
          credit = await pb.collection('credit').create({
            user_id: userId,
            balance: 0,
          });
        }

        if (credit) {
          const currentBalance = credit.balance || 0;
          const newBalance = currentBalance + payment.amount;

          await pb.collection('credit').update(credit.id, {
            balance: newBalance,
          });

          console.log('[checkAndUpdatePaymentStatus] Added credits:', {
            userId,
            amount: payment.amount,
            newBalance,
          });

          // Create transaction record
          const paymentMethod = payment.metadata?.data?.payment_name || 'Tripay';
          await pb.collection('transaction').create({
            user_id: userId,
            type: 'DEBIT',
            amount: payment.amount,
            desc: `Top Up via ${paymentMethod}`,
            ref: payment.ref,
          });
        }
      }

      return { updated: true, newStatus: tripayStatus };
    }

    return { updated: false, newStatus: payment.status };
  } catch (error) {
    console.error('[checkAndUpdatePaymentStatus] Error:', error);
    return { updated: false, newStatus: payment.status };
  }
}

/**
 * GET /api/history/payment
 * Get payment history for user
 * Auto-check UNPAID payments status from Tripay
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

    // Check UNPAID payments in parallel and update status
    const unpaidPayments = payments.filter(p => p.status === 'UNPAID');
    if (unpaidPayments.length > 0) {
      console.log('[/api/history/payment] Checking', unpaidPayments.length, 'UNPAID payments...');

      // Check all unpaid payments in parallel
      const checkPromises = unpaidPayments.map(payment =>
        checkAndUpdatePaymentStatus(pb, payment, userId)
      );

      await Promise.all(checkPromises);

      // Re-fetch payments after updates to get latest status
      const updatedPayments = await pb.collection('payment').getFullList({
        filter: `user_id="${userId}"`,
        sort: '-created',
      });

      console.log('[/api/history/payment] Returning updated payment list');

      return res.json({
        success: true,
        data: updatedPayments.map((payment) => ({
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
    }

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
