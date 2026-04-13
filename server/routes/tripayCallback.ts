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

    const db = getDb();

    // Find payment record by merchant_ref in metadata (JSONB)
    let payment: PaymentRecord | null = null;

    // Try metadata->>merchant_ref first
    const { data: payment1 } = await db
      .from('payments')
      .select('*')
      .filter('metadata->>merchant_ref', 'eq', merchant_ref)
      .maybeSingle();
    payment = payment1;

    // Fallback: try metadata->data->>merchant_ref
    if (!payment) {
      const { data: payment2 } = await db
        .from('payments')
        .select('*')
        .filter('metadata->data->>merchant_ref', 'eq', merchant_ref)
        .maybeSingle();
      payment = payment2 || null;
    }

    if (!payment) {
      console.error('[/api/tripay/callback] Payment not found for merchant_ref:', merchant_ref);
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    await db
      .from('payments')
      .update({
        status,
        metadata: {
          ...payment.metadata,
          callback: req.body,
          callback_at: new Date().toISOString(),
        },
      })
      .eq('id', payment.id);

    console.log('[/api/tripay/callback] Payment updated:', payment.id, '->', status);

    if (status === 'PAID') {
      const userId = payment.user_id;
      const amount = payment.amount;

      console.log('[/api/tripay/callback] Adding credits to user:', { userId, amount });

      let { data: credit, error: creditError } = await db
        .from('credits')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!credit) {
        const { data: newCredit, error: createError } = await db
          .from('credits')
          .insert({ user_id: userId, balance: 0 })
          .select()
          .single();

        if (createError) {
          console.error('[/api/tripay/callback] Failed to create credit record:', createError);
          return res.status(500).json({ success: false, message: 'Failed to create credit record' });
        }
        credit = newCredit;
      }

      if (!credit) {
        console.error('[/api/tripay/callback] Failed to create credit record');
        return res.status(500).json({ success: false, message: 'Failed to create credit record' });
      }

      const currentBalance = credit.balance || 0;
      const newBalance = currentBalance + amount;

      await db.from('credits').update({ balance: newBalance }).eq('id', credit.id);

      console.log('[/api/tripay/callback] Credits added:', { userId, previousBalance: currentBalance, addedAmount: amount, newBalance });

      await db.from('transactions').insert({
        user_id: userId,
        type: 'DEBIT',
        amount,
        description: `Top Up via ${payment_method || 'Tripay'}`,
        ref: merchant_ref,
      });
    }

    res.json({ success: true, message: 'Callback processed successfully' });
  } catch (error) {
    console.error('[/api/tripay/callback] Error:', error);
    res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Unknown error' });
  }
});
