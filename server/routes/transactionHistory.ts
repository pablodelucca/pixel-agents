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

    const pb = await getDb();

    const transactions = await pb.collection('transaction').getFullList<TransactionRecord>({
      filter: `user_id="${userId}"`,
      sort: '-created',
    });

    res.json({
      success: true,
      data: transactions.map((t) => ({
        id: t.id,
        userId: t.user_id,
        desc: t.desc,
        type: t.type,
        amount: t.amount,
        created: t.created,
        updated: t.updated,
      })),
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
