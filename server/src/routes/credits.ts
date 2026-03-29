import { Router } from 'express';
import PocketBase from 'pocketbase';
import axios from 'axios';
import crypto from 'crypto';

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

// PocketBase connection
const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'admin@example.com';
const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || 'admin123';

// Cache for PocketBase admin client
let pbAdmin: PocketBase | null = null;
let adminAuthExpiry = 0;

async function getPbAdminClient(): Promise<PocketBase> {
  const pb = new PocketBase(POCKETBASE_URL);

  // Check if we need to re-authenticate (token expires after ~1 hour)
  const now = Date.now();
  if (!pbAdmin || adminAuthExpiry < now) {
    console.log('[PocketBase/Credits] Authenticating as admin...');
    try {
      await pb.admins.authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
      pbAdmin = pb;
      // Set expiry to 50 minutes from now (tokens usually last 1 hour)
      adminAuthExpiry = now + 50 * 60 * 1000;
      console.log('[PocketBase/Credits] Admin authenticated successfully');
    } catch (err) {
      console.error('[PocketBase/Credits] Failed to authenticate as admin:', err);
      throw new Error('PocketBase admin authentication failed');
    }
  }

  return pbAdmin;
}

/**
 * Normalize user ID - strip 'did:privy:' prefix if present
 * Privy returns: 'did:privy:cmn2s6xm0028b0djuvks8lv19'
 * PocketBase stores: 'cmn2s6xm0028b0djuvks8lv19'
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
 * GET /api/credits
 * Get or create credit balance for user
 * - If credit record exists, return balance
 * - If not, create a new record with balance 0 and return it
 */
creditsRoutes.get('/', async (req, res) => {
  try {
    const userId = getUserId(req);

    console.log('[/api/credits] Fetching credits for userId:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getPbAdminClient();

    // Try to find existing credit record
    try {
      const credit = await pb.collection('credit').getFirstListItem(
        `user_id="${userId}"`,
      );

      console.log('[/api/credits] Found existing credit record:', credit.id);

      res.json({
        success: true,
        balance: credit.balance || 0,
      });
    } catch (pbError: any) {
      // Record not found - create new one
      if (pbError.status === 404) {
        console.log('[/api/credits] No credit record found, creating new one for user:', userId);

        const newCredit = await pb.collection('credit').create({
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
 * Create a new credit record manually (optional - usually auto-created on first fetch)
 */
creditsRoutes.post('/', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { balance = 0 } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    const pb = await getPbAdminClient();

    // Check if credit record already exists
    const existingCredit = await pb.collection('credit').getFirstListItem(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (existingCredit) {
      return res.status(400).json({
        success: false,
        error: 'Credit record already exists for this user',
        balance: existingCredit.balance || 0,
      });
    }

    // Create new credit record
    const credit = await pb.collection('credit').create({
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
 * Update credit balance (e.g., after top-up or deduction)
 */
creditsRoutes.put('/', async (req, res) => {
  try {
    const userId = getUserId(req);
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

    const pb = await getPbAdminClient();

    // Find existing credit record
    const credit = await pb.collection('credit').getFirstListItem(
      `user_id="${userId}"`,
    ).catch(() => null);

    if (!credit) {
      return res.status(404).json({
        success: false,
        error: 'Credit record not found',
      });
    }

    // Update balance
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
 * Add amount to current balance (positive for top-up, negative for deduction)
 */
creditsRoutes.post('/add', async (req, res) => {
  try {
    const userId = getUserId(req);
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

    const pb = await getPbAdminClient();

    // Find existing credit record
    let credit = await pb.collection('credit').getFirstListItem(
      `user_id="${userId}"`,
    ).catch(() => null);

    // If no record exists, create one first
    if (!credit) {
      credit = await pb.collection('credit').create({
        user_id: userId,
        balance: 0,
      });
    }

    // Ensure credit exists after creation
    if (!credit) {
      res.status(500).json({ error: 'Failed to create credit record' });
      return;
    }

    // Calculate new balance
    const currentBalance = credit.balance || 0;
    const newBalance = currentBalance + amount;

    // Update balance
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
    const userId = getUserId(req);
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

    // Tripay configuration
    const apiKey = process.env.TRIPAY_API_KEY;
    const privateKey = process.env.TRIPAY_PRIVATE_KEY;
    const merchantCode = process.env.TRIPAY_MERCHANT_CODE;
    const apiUrl = process.env.TRIPAY_API_URL;

    if (!apiKey || !privateKey || !merchantCode || !apiUrl) {
      console.error('[/api/credits/topup] Tripay configuration missing');
      return res.status(500).json({
        success: false,
        error: 'Payment gateway not configured',
      });
    }

    // Generate merchant reference
    const timestamp = Math.floor(Date.now() / 1000);
    const random = Math.floor(Math.random() * 10000);
    const merchantRef = `CLW-${timestamp}-${random}`;

    // Get frontend URL for return_url
    // Tripay will append tripay_ref and merchant_ref to this URL automatically
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const returnUrl = `${frontendUrl}/payment/status`;

    // Create Tripay signature
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

    // Call Tripay API
    const tripayResponse = await axios.post(
      apiUrl,
      {
        method: method,
        merchant_ref: merchantRef,
        amount: amount,
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
        expired_time: timestamp + 24 * 60 * 60, // 24 hours
        signature: signature,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        validateStatus: (status) => status < 999,
      }
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

    // Save payment record to PocketBase
    const pb = await getPbAdminClient();

    const payment = await pb.collection('payment').create({
      user_id: userId,
      amount: amount,
      status: paymentStatus,
      url: checkoutUrl,
      metadata: {
        ...tripayResponse.data,
        merchant_ref: merchantRef,
        tripay_ref: tripayRef,
      },
    });

    console.log('[/api/credits/topup] Payment record created:', payment.id);

    // Return checkout URL to frontend
    res.json({
      success: true,
      data: {
        paymentId: payment.id,
        merchantRef: merchantRef,
        tripayRef: tripayRef,
        checkoutUrl: checkoutUrl,
        amount: amount,
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
 * Called when user returns from Tripay checkout page
 * 
 * Query params:
 * - tripay_ref = Tripay transaction reference (from tripay_reference in return URL)
 * - merchant_ref = Our merchant reference (from tripay_merchant_ref in return URL)
 */
creditsRoutes.get('/topup/status', async (req, res) => {
  try {
    const tripayRef = req.query.tripay_ref as string;
    const merchantRef = req.query.merchant_ref as string;
    const userId = getUserId(req);

    console.log('[/api/credits/topup/status] Checking status:', { tripayRef, merchantRef, userId });

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - User ID required',
      });
    }

    if (!merchantRef) {
      return res.status(400).json({
        success: false,
        error: 'merchant_ref is required',
      });
    }

    const pb = await getPbAdminClient();

    // Find payment record by tripay_ref in URL
    // URL format: https://tripay.co.id/checkout/{tripay_ref}
    const payment = await pb.collection('payment').getFirstListItem(
      `url ~ "${tripayRef}"`,
    ).catch(() => null);

    if (!payment) {
      console.log('[/api/credits/topup/status] Payment not found for tripay_ref:', tripayRef);
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
      });
    }

    // Verify user owns this payment
    if (payment.user_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    // If already paid, return current status
    if (payment.status === 'PAID') {
      return res.json({
        success: true,
        data: {
          status: 'PAID',
          amount: payment.amount,
          paymentId: payment.id,
        },
      });
    }

    // If pending/unpaid, check Tripay for latest status
    const { apiKey, apiUrl } = getTripayConfig();

    if (!apiKey || !apiUrl) {
      return res.status(500).json({
        success: false,
        error: 'Payment gateway not configured',
      });
    }

    // Build Tripay API base URL (remove /transaction/create suffix)
    const baseUrl = apiUrl.replace('/transaction/create', '');
    const checkUrl = `${baseUrl}/transaction/detail?reference=${tripayRef}`;

    console.log('[/api/credits/topup/status] Checking Tripay:', checkUrl);

    const tripayResponse = await axios.get(checkUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      validateStatus: (status) => status < 999,
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

    // If PAID, update database and add credits
    if (tripayStatus === 'PAID') {
      console.log('[/api/credits/topup/status] Payment confirmed! Updating database...');

      // Update payment status
      await pb.collection('payment').update(payment.id, {
        status: 'PAID',
        metadata: {
          ...payment.metadata,
          status_check: tripayResponse.data,
          paid_at: new Date().toISOString(),
        },
      });

      // Add credits to user
      let credit = await pb.collection('credit').getFirstListItem(
        `user_id="${userId}"`,
      ).catch(() => null);

      if (!credit) {
        credit = await pb.collection('credit').create({
          user_id: userId,
          balance: 0,
        });
      }

      if (!credit) {
        return res.status(500).json({
          success: false,
          error: 'Failed to create credit record',
        });
      }

      const currentBalance = credit.balance || 0;
      const newBalance = currentBalance + payment.amount;

      await pb.collection('credit').update(credit.id, {
        balance: newBalance,
      });

      console.log('[/api/credits/topup/status] Credits added:', {
        userId,
        previousBalance: currentBalance,
        addedAmount: payment.amount,
        newBalance: newBalance,
      });

      // Create transaction record
      await pb.collection('transaction').create({
        user_id: userId,
        type: 'DEBIT',
        amount: payment.amount,
        desc: `Top Up via Tripay (${payment.method || 'Payment Gateway'})`,
        ref: merchantRef,
      });

      return res.json({
        success: true,
        data: {
          status: 'PAID',
          amount: payment.amount,
          paymentId: payment.id,
          newBalance: newBalance,
        },
      });
    }

    // Return current status
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
