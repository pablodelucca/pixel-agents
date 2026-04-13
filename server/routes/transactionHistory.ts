import { Router } from 'express';

import type { TransactionRecord } from '../../src/shared/index.js';
import { getUserIdFromRequest } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';

export const transactionHistoryRoutes = Router();

/**
 * GET /api/history/transaction
 */
transactionHistoryRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);

    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });

    const db = getDb();

    const { data: transactions, error } = await db
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      data: (transactions || []).map((t: TransactionRecord) => ({
        id: t.id,
        userId: t.user_id,
        desc: t.description,
        type: t.type,
        amount: t.amount,
        created: t.created_at,
        updated: t.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
