import { Router } from 'express';
import axios from 'axios';

import type { CreditRecord, PaymentRecord, TransactionRecord } from '../../src/shared/index.js';
import { getUserIdFromRequest } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';

export const paymentHistoryRoutes = Router();

/**
 * Check payment status from Tripay and update if paid
 */
async function checkAndUpdatePaymentStatus(
  db: any,
  payment: PaymentRecord,
  userId: string,
): Promise<{ updated: boolean; newStatus: string }> {
  if (payment.status !== 'UNPAID') {
    return { updated: false, newStatus: payment.status };
  }

  const tripayRef = (payment.metadata as any)?.data?.reference;
  if (!tripayRef) {
    return { updated: false, newStatus: payment.status };
  }

  const apiKey = process.env.TRIPAY_API_KEY;
  const apiUrl = process.env.TRIPAY_API_URL;

  if (!apiKey || !apiUrl) return { updated: false, newStatus: payment.status };

  try {
    const baseUrl = apiUrl.replace('/transaction/create', '');
    const checkUrl = `${baseUrl}/transaction/detail?reference=${tripayRef}`;

    const response = await axios.get(checkUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      validateStatus: (status: number) => status < 999,
    });

    if (!response.data.success) return { updated: false, newStatus: payment.status };

    const tripayStatus = response.data.data?.status;

    if (tripayStatus && tripayStatus !== payment.status) {
      await db
        .from('payments')
        .update({
          status: tripayStatus,
          metadata: { ...payment.metadata, status_check: response.data, checked_at: new Date().toISOString() },
        })
        .eq('id', payment.id);

      if (tripayStatus === 'PAID') {
        let { data: credit } = await db
          .from('credits')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (!credit) {
          const { data: newCredit } = await db
            .from('credits')
            .insert({ user_id: userId, balance: 0 })
            .select()
            .single();
          credit = newCredit;
        }

        if (credit) {
          const newBalance = (credit.balance || 0) + payment.amount;
          await db.from('credits').update({ balance: newBalance }).eq('id', credit.id);

          const paymentMethod = (payment.metadata as any)?.data?.payment_name || 'Tripay';
          await db.from('transactions').insert({
            user_id: userId,
            type: 'DEBIT',
            amount: payment.amount,
            description: `Top Up via ${paymentMethod}`,
            ref: (payment as any).ref,
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
 */
paymentHistoryRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);

    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });

    const db = getDb();

    const { data: payments, error } = await db
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const paymentList = payments || [];

    // Check and update unpaid payments
    const unpaidPayments = paymentList.filter((p: PaymentRecord) => p.status === 'UNPAID');
    if (unpaidPayments.length > 0) {
      await Promise.all(unpaidPayments.map((payment: PaymentRecord) => checkAndUpdatePaymentStatus(db, payment, userId)));

      // Re-fetch after updates
      const { data: updatedPayments, error: refetchError } = await db
        .from('payments')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (refetchError) throw new Error(refetchError.message);

      return res.json({
        success: true,
        data: (updatedPayments || []).map((p: PaymentRecord) => ({
          id: p.id,
          userId: p.user_id,
          amount: p.amount,
          status: p.status,
          url: p.url,
          metadata: p.metadata,
          created: p.created_at,
          updated: p.updated_at,
        })),
      });
    }

    res.json({
      success: true,
      data: paymentList.map((p: PaymentRecord) => ({
        id: p.id,
        userId: p.user_id,
        amount: p.amount,
        status: p.status,
        url: p.url,
        metadata: p.metadata,
        created: p.created_at,
        updated: p.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
