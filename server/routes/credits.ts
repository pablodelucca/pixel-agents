import { Router } from 'express';
import axios from 'axios';
import crypto from 'crypto';

import type { CreditRecord, PaymentRecord, TransactionRecord } from '../../src/shared/index.js';
import { getUserIdFromRequest } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';

export const creditsRoutes = Router();

// Tripay configuration helper
function getTripayConfig() {
  return {
    apiKey: process.env.TRIPAY_API_KEY,
    privateKey: process.env.TRIPAY_PRIVATE_KEY,
    merchantCode: process.env.TRIPAY_MERCHANT_CODE,
    apiUrl: process.env.TRIPAY_API_URL,
  };
}

/**
 * GET /api/credits
 * Get or create credit balance for user
 */
creditsRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);

    console.log('[/api/credits] Fetching credits for userId:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getDb();

    try {
      const credit = await pb.collection('credit').getFirstListItem<CreditRecord>(
        `user_id="${userId}"`,
      );

      console.log('[/api/credits] Found existing credit record:', credit.id);

      res.json({
        success: true,
        balance: credit.balance || 0,
      });
    } catch (pbError: any) {
      if (pbError.status === 404) {
        console.log('[/api/credits] No credit record found, creating new one for user:', userId);

        const newCredit = await pb.collection('credit').create<CreditRecord>({
          user_id: userId,
          balance: 0,
        });

        console.log('[/api/credits] Created new credit record:', newCredit.id);

        res.json({
          success: true,
          balance: newCredit.balance || 0,
        });
      } else {
        throw pbError;
      }
    }
  } catch (error) {
    console.error('Error fetching credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/credits
 * Create a new credit record manually
 */
creditsRoutes.post('/', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { balance = 0 } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getDb();

    const existingCredit = await pb.collection('credit').getFirstListItem<CreditRecord>(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (existingCredit) {
      return res.status(400).json({
        success: false,
        error: 'Credit record already exists for this user',
        balance: existingCredit.balance || 0,
      });
    }

    const credit = await pb.collection('credit').create<CreditRecord>({
      user_id: userId,
      balance: balance,
    });

    res.json({
      success: true,
      balance: credit.balance || 0,
    });
  } catch (error) {
    console.error('Error creating credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/credits
 * Update credit balance
 */
creditsRoutes.put('/', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { balance } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    if (typeof balance !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Balance must be a number',
      });
    }

    const pb = await getDb();

    const credit = await pb.collection('credit').getFirstListItem<CreditRecord>(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (!credit) {
      return res.status(404).json({
        success: false,
        error: 'Credit record not found',
      });
    }

    await pb.collection('credit').update(credit.id, {
      balance: balance,
    });

    res.json({
      success: true,
      balance: balance,
    });
  } catch (error) {
    console.error('Error updating credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/credits/add
 * Add amount to current balance
 */
creditsRoutes.post('/add', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { amount } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    if (typeof amount !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a number',
      });
    }

    const pb = await getDb();

    let credit = await pb.collection('credit').getFirstListItem<CreditRecord>(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (!credit) {
      credit = await pb.collection('credit').create<CreditRecord>({
        user_id: userId,
        balance: 0,
      });
    }

    if (!credit) {
      res.status(500).json({ error: 'Failed to create credit record' });
      return;
    }

    const currentBalance = credit.balance || 0;
    const newBalance = currentBalance + amount;

    await pb.collection('credit').update(credit.id, {
      balance: newBalance,
    });

    res.json({
      success: true,
      balance: newBalance,
    });
  } catch (error) {
    console.error('Error adding credits:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/credits/topup
 * Create a Tripay payment transaction for topping up credits
 */
creditsRoutes.post('/topup', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { amount, method, customerName, customerEmail, customerPhone } = req.body;

    console.log('[/api/credits/topup] Top up request:', { userId, amount, method });

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount - must be a positive number',
      });
    }

    if (!method) {
      return res.status(400).json({
        success: false,
        error: 'Payment method is required',
      });
    }

    const { apiKey, privateKey, merchantCode, apiUrl } = getTripayConfig();

    if (!apiKey || !privateKey || !merchantCode || !apiUrl) {
      console.error('[/api/credits/topup] Tripay configuration missing');
      return res.status(500).json({
        success: false,
        error: 'Payment gateway not configured',
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const random = Math.floor(Math.random() * 10000);
    const merchantRef = `CLW-${timestamp}-${random}`;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const returnUrl = `${frontendUrl}/payment/status`;

    const signature = crypto
      .createHmac('sha256', privateKey)
      .update(merchantCode + merchantRef + amount.toString())
      .digest('hex');

    console.log('[/api/credits/topup] Creating Tripay transaction:', {
      merchantRef,
      amount,
      method,
      signature: signature.substring(0, 16) + '...',
    });

    const tripayResponse = await axios.post(
      apiUrl,
      {
        method,
        merchant_ref: merchantRef,
        amount,
        customer_name: customerName || 'Customer',
        customer_email: customerEmail || 'customer@example.com',
        customer_phone: customerPhone || '08123456789',
        order_items: [
          {
            sku: 'CREDITS-TOPUP',
            name: `Top Up Credits Rp ${amount.toLocaleString('id-ID')}`,
            price: amount,
            quantity: 1,
          },
        ],
        return_url: returnUrl,
        expired_time: timestamp + 24 * 60 * 60,
        signature,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        validateStatus: (status: number) => status < 999,
      },
    );

    console.log('[/api/credits/topup] Tripay response:', {
      success: tripayResponse.data.success,
      status: tripayResponse.status,
    });

    if (!tripayResponse.data.success) {
      console.error('[/api/credits/topup] Tripay error:', tripayResponse.data);
      return res.status(400).json({
        success: false,
        error: 'Failed to create payment transaction',
        details: tripayResponse.data,
      });
    }

    const checkoutUrl = tripayResponse.data.data?.checkout_url;
    const tripayRef = tripayResponse.data.data?.reference;
    const paymentStatus = tripayResponse.data.data?.status || 'PENDING';

    const pb = await getDb();

    const payment = await pb.collection('payment').create<PaymentRecord>({
      user_id: userId,
      amount,
      status: paymentStatus,
      url: checkoutUrl,
      metadata: {
        ...tripayResponse.data,
        merchant_ref: merchantRef,
        tripay_ref: tripayRef,
      },
    });

    console.log('[/api/credits/topup] Payment record created:', payment.id);

    res.json({
      success: true,
      data: {
        paymentId: payment.id,
        merchantRef,
        tripayRef,
        checkoutUrl,
        amount,
        status: paymentStatus,
      },
    });
  } catch (error) {
    console.error('Error creating top up transaction:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/credits/topup/status
 * Check payment status from Tripay and update database if paid
 */
creditsRoutes.get('/topup/status', async (req, res) => {
  try {
    const tripayRef = req.query.tripay_ref as string;
    const merchantRef = req.query.merchant_ref as string;
    const userId = getUserIdFromRequest(req);

    console.log('[/api/credits/topup/status] Checking status:', { tripayRef, merchantRef, userId });

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized - User ID required' });
    }

    if (!merchantRef) {
      return res.status(400).json({ success: false, error: 'merchant_ref is required' });
    }

    const pb = await getDb();

    const payment = await pb.collection('payment').getFirstListItem<PaymentRecord>(
      `url ~ "${tripayRef}"`,
    ).catch(() => null);

    if (!payment) {
      console.log('[/api/credits/topup/status] Payment not found for tripay_ref:', tripayRef);
      return res.status(404).json({ success: false, error: 'Payment not found' });
    }

    if (payment.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (payment.status === 'PAID') {
      return res.json({
        success: true,
        data: { status: 'PAID', amount: payment.amount, paymentId: payment.id },
      });
    }

    const { apiKey, apiUrl } = getTripayConfig();

    if (!apiKey || !apiUrl) {
      return res.status(500).json({ success: false, error: 'Payment gateway not configured' });
    }

    const baseUrl = apiUrl.replace('/transaction/create', '');
    const checkUrl = `${baseUrl}/transaction/detail?reference=${tripayRef}`;

    console.log('[/api/credits/topup/status] Checking Tripay:', checkUrl);

    const tripayResponse = await axios.get(checkUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      validateStatus: (status: number) => status < 999,
    });

    if (!tripayResponse.data.success) {
      console.error('[/api/credits/topup/status] Tripay error:', tripayResponse.data);
      return res.status(400).json({
        success: false,
        error: 'Failed to check payment status',
        details: tripayResponse.data,
      });
    }

    const tripayStatus = tripayResponse.data.data?.status;
    console.log('[/api/credits/topup/status] Tripay status:', tripayStatus);

    if (tripayStatus === 'PAID') {
      console.log('[/api/credits/topup/status] Payment confirmed! Updating database...');

      await pb.collection('payment').update(payment.id, {
        status: 'PAID',
        metadata: {
          ...payment.metadata,
          status_check: tripayResponse.data,
          paid_at: new Date().toISOString(),
        },
      });

      let credit = await pb.collection('credit').getFirstListItem<CreditRecord>(
        `user_id="${userId}"`,
      ).catch(() => null);

      if (!credit) {
        credit = await pb.collection('credit').create<CreditRecord>({
          user_id: userId,
          balance: 0,
        });
      }

      if (!credit) {
        return res.status(500).json({ success: false, error: 'Failed to create credit record' });
      }

      const currentBalance = credit.balance || 0;
      const newBalance = currentBalance + payment.amount;

      await pb.collection('credit').update(credit.id, { balance: newBalance });

      console.log('[/api/credits/topup/status] Credits added:', {
        userId,
        previousBalance: currentBalance,
        addedAmount: payment.amount,
        newBalance,
      });

      await pb.collection('transaction').create<TransactionRecord>({
        user_id: userId,
        type: 'DEBIT',
        amount: payment.amount,
        desc: `Top Up via Tripay (${payment.method || 'Payment Gateway'})`,
        ref: merchantRef,
      });

      return res.json({
        success: true,
        data: { status: 'PAID', amount: payment.amount, paymentId: payment.id, newBalance },
      });
    }

    return res.json({
      success: true,
      data: {
        status: tripayStatus || payment.status,
        amount: payment.amount,
        paymentId: payment.id,
      },
    });
  } catch (error) {
    console.error('Error checking payment status:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
