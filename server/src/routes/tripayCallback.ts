import { Router, Request, Response } from 'express';
import PocketBase from 'pocketbase';
import crypto from 'crypto';

export const tripayCallbackRoutes = Router();

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
    console.log('[PocketBase/TripayCallback] Authenticating as admin...');
    try {
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      adminAuthExpiry = now + 50 * 60 * 1000;
      console.log('[PocketBase/TripayCallback] Admin authenticated successfully');
    } catch (err) {
      console.error('[PocketBase/TripayCallback] Failed to authenticate as admin:', err);
      throw new Error('PocketBase admin authentication failed');
    }
  }

  return pbAdmin;
}

/**
 * POST /api/tripay/callback
 * Webhook endpoint for Tripay payment callback
 * 
 * Tripay will send a callback when payment status changes
 * Documentation: https://tripay.co.id/developer?tab=callback
 */
tripayCallbackRoutes.post('/callback', async (req: Request, res: Response) => {
  try {
    console.log('[/api/tripay/callback] Received callback:', JSON.stringify(req.body, null, 2));

    const callbackSignature = req.headers['x-callback-signature'] as string;
    const privateKey = process.env.TRIPAY_PRIVATE_KEY;

    if (!privateKey) {
      console.error('[/api/tripay/callback] TRIPAY_PRIVATE_KEY not configured');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
      });
    }

    // Verify callback signature
    const jsonBody = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', privateKey)
      .update(jsonBody)
      .digest('hex');

    if (callbackSignature !== expectedSignature) {
      console.error('[/api/tripay/callback] Invalid signature', {
        received: callbackSignature,
        expected: expectedSignature,
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid signature',
      });
    }

    const { merchant_ref, status, payment_method, total_amount } = req.body;

    console.log('[/api/tripay/callback] Payment status:', {
      merchant_ref,
      status,
      payment_method,
      total_amount,
    });

    const pb = await getPbAdminClient();

    // Find payment record by merchant_ref in metadata
    const payment = await pb.collection('payment').getFirstListItem(
      `metadata.merchant_ref = "${merchant_ref}"`,
    ).catch(() => null);

    // Fallback: try to find by data.merchant_ref in metadata (old structure)
    const paymentFinal = payment || await pb.collection('payment').getFirstListItem(
      `metadata.data.merchant_ref = "${merchant_ref}"`,
    ).catch(() => null);

    if (!paymentFinal) {
      console.error('[/api/tripay/callback] Payment not found for merchant_ref:', merchant_ref);
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    // Update payment status
    await pb.collection('payment').update(paymentFinal.id, {
      status: status,
      metadata: {
        ...paymentFinal.metadata,
        callback: req.body,
        callback_at: new Date().toISOString(),
      },
    });

    console.log('[/api/tripay/callback] Payment updated:', paymentFinal.id, '->', status);

    // If payment is PAID, add credits to user
    if (status === 'PAID') {
      const userId = paymentFinal.user_id;
      const amount = paymentFinal.amount;

      console.log('[/api/tripay/callback] Adding credits to user:', { userId, amount });

      // Find or create credit record
      let credit = await pb.collection('credit').getFirstListItem(
        `user_id="${userId}"`,
      ).catch(() => null);

      if (!credit) {
        credit = await pb.collection('credit').create({
          user_id: userId,
          balance: 0,
        });
      }

      // Ensure credit exists (should never be null after create)
      if (!credit) {
        console.error('[/api/tripay/callback] Failed to create credit record for user:', userId);
        return res.status(500).json({
          success: false,
          message: 'Failed to create credit record',
        });
      }

      // Update balance
      const currentBalance = credit.balance || 0;
      const newBalance = currentBalance + amount;

      await pb.collection('credit').update(credit.id, {
        balance: newBalance,
      });

      console.log('[/api/tripay/callback] Credits added:', {
        userId,
        previousBalance: currentBalance,
        addedAmount: amount,
        newBalance: newBalance,
      });

      // Create transaction record
      await pb.collection('transaction').create({
        user_id: userId,
        type: 'DEBIT', // DEBIT = uang masuk
        amount: amount,
        desc: `Top Up via ${payment_method || 'Tripay'}`,
        ref: merchant_ref,
      });

      console.log('[/api/tripay/callback] Transaction record created');
    }

    // Return success response to Tripay
    res.json({
      success: true,
      message: 'Callback processed successfully',
    });
  } catch (error) {
    console.error('[/api/tripay/callback] Error processing callback:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
