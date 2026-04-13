import { Router } from 'express';

export const paymentRoutes = Router();

/**
 * GET /api/payment/config
 * Returns payment configuration including recipient wallet address
 * This is secure because the address is stored in server env, not exposed in frontend
 */
paymentRoutes.get('/config', (_req, res) => {
  const recipientAddress = process.env.PAYMENT_RECIPIENT_ADDRESS;

  if (!recipientAddress || recipientAddress === '0xYourWalletAddressHere') {
    console.error('[/api/payment/config] PAYMENT_RECIPIENT_ADDRESS not configured in server/.env');
    return res.status(500).json({
      success: false,
      error: 'Payment configuration not set up',
    });
  }

  res.json({
    success: true,
    data: {
      recipientAddress,
      // Could add more config here in the future (e.g., chain ID, USDC contract)
      chainId: '0x2105', // Base mainnet
      usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  });
});
