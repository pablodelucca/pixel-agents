import { Router, Request, Response } from 'express';
import crypto from 'crypto';

import type { CreditRecord, PaymentRecord, TransactionRecord } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';

export const tripayCallbackRoutes = Router();

/**
 * POST /api/tripay/callback
 * Webhook endpoint for Tripay payment callback
 */
tripayCallbackRoutes.post('/callback', async (req: Request, res: Response) => {
  try {
    console.log('[/api/tripay/callback] Received callback:', JSON.stringify(req.body, null, 2));

    const callbackSignature = req.headers['x-callback-signature'] as string;
    const privateKey = process.env.TRIPAY_PRIVATE_KEY;

    if (!privateKey) {
      console.error('[/api/tripay/callback] TRIPAY_PRIVATE_KEY not configured');
      return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    // Verify callback signature
    const jsonBody = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', privateKey)
      .update(jsonBody)
      .digest('hex');

    if (callbackSignature !== expectedSignature) {
      console.error('[/api/tripay/callback] Invalid signature');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    const { merchant_ref, status, payment_method, total_amount } = req.body;

    console.log('[/api/tripay/callback] Payment status:', { merchant_ref, status, payment_method, total_amount });

    const pb = await getDb();

    // Find payment record by merchant_ref
    const payment = await pb.collection('payment').getFirstListItem<PaymentRecord>(
      `metadata.merchant_ref = "${merchant_ref}"`,
    ).catch(() => null);

    const paymentFinal = payment || await pb.collection('payment').getFirstListItem<PaymentRecord>(
      `metadata.data.merchant_ref = "${merchant_ref}"`,
    ).catch(() => null);

    if (!paymentFinal) {
      console.error('[/api/tripay/callback] Payment not found for merchant_ref:', merchant_ref);
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    await pb.collection('payment').update(paymentFinal.id, {
      status,
      metadata: {
        ...paymentFinal.metadata,
        callback: req.body,
        callback_at: new Date().toISOString(),
      },
    });

    console.log('[/api/tripay/callback] Payment updated:', paymentFinal.id, '->', status);

    if (status === 'PAID') {
      const userId = paymentFinal.user_id;
      const amount = paymentFinal.amount;

      console.log('[/api/tripay/callback] Adding credits to user:', { userId, amount });

      let credit = await pb.collection('credit').getFirstListItem<CreditRecord>(
        `user_id="${userId}"`,
      ).catch(() => null);

      if (!credit) {
        credit = await pb.collection('credit').create<CreditRecord>({ user_id: userId, balance: 0 });
      }

      if (!credit) {
        console.error('[/api/tripay/callback] Failed to create credit record');
        return res.status(500).json({ success: false, message: 'Failed to create credit record' });
      }

      const currentBalance = credit.balance || 0;
      const newBalance = currentBalance + amount;

      await pb.collection('credit').update(credit.id, { balance: newBalance });

      console.log('[/api/tripay/callback] Credits added:', { userId, previousBalance: currentBalance, addedAmount: amount, newBalance });

      await pb.collection('transaction').create<TransactionRecord>({
        user_id: userId,
        type: 'DEBIT',
        amount,
        desc: `Top Up via ${payment_method || 'Tripay'}`,
        ref: merchant_ref,
      });
    }

    res.json({ success: true, message: 'Callback processed successfully' });
  } catch (error) {
    console.error('[/api/tripay/callback] Error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Unknown error' });
  }
});
