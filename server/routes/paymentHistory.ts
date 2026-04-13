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
  pb: any,
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
      await pb.collection('payment').update(payment.id, {
        status: tripayStatus,
        metadata: { ...payment.metadata, status_check: response.data, checked_at: new Date().toISOString() },
      });

      if (tripayStatus === 'PAID') {
        let credit: any = await pb.collection('credit').getFirstListItem(`user_id="${userId}"`).catch(() => null);
        if (!credit) credit = await pb.collection('credit').create({ user_id: userId, balance: 0 });

        if (credit) {
          const newBalance = (credit.balance || 0) + payment.amount;
          await pb.collection('credit').update(credit.id, { balance: newBalance });

          const paymentMethod = (payment.metadata as any)?.data?.payment_name || 'Tripay';
          await pb.collection('transaction').create({
            user_id: userId,
            type: 'DEBIT',
            amount: payment.amount,
            desc: `Top Up via ${paymentMethod}`,
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

    const pb = await getDb();

    const payments = await pb.collection('payment').getFullList<PaymentRecord>({
      filter: `user_id="${userId}"`,
      sort: '-created',
    });

    const unpaidPayments = payments.filter((p) => p.status === 'UNPAID');
    if (unpaidPayments.length > 0) {
      await Promise.all(unpaidPayments.map((payment) => checkAndUpdatePaymentStatus(pb, payment, userId)));

      const updatedPayments = await pb.collection('payment').getFullList<PaymentRecord>({
        filter: `user_id="${userId}"`,
        sort: '-created',
      });

      return res.json({
        success: true,
        data: updatedPayments.map((p) => ({
          id: p.id,
          userId: p.user_id,
          amount: p.amount,
          status: p.status,
          url: p.url,
          metadata: p.metadata,
          created: p.created,
          updated: p.updated,
        })),
      });
    }

    res.json({
      success: true,
      data: payments.map((p) => ({
        id: p.id,
        userId: p.user_id,
        amount: p.amount,
        status: p.status,
        url: p.url,
        metadata: p.metadata,
        created: p.created,
        updated: p.updated,
      })),
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
