// Load environment variables FIRST before any other imports
import './env.js';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

import { creditsRoutes } from './routes/credits.js';
import { officesRoutes } from './routes/offices.js';
import { paymentRoutes } from './routes/payment.js';
import { paymentHistoryRoutes } from './routes/paymentHistory.js';
import { serverRoutes } from './routes/servers.js';
import { transactionHistoryRoutes } from './routes/transactionHistory.js';
import { tripayCallbackRoutes } from './routes/tripayCallback.js';
import { usersRoutes } from './routes/users.js';

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || '';
const DB_URL = process.env.SUPABASE_URL || 'not configured';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://auth.privy.io"],
      connectSrc: [
        "'self'",
        "https://auth.privy.io",
        "https://api.privy.io",
        "wss://relay.walletconnect.com",
        "wss://walletconnect.com",
        "https://rpc.walletconnect.com",
        "https://*.supabase.co",
        "https://api.tripay.co.id",
      ],
      frameSrc: ["'self'", "https://auth.privy.io", "https://embed.privy.io"],
      imgSrc: ["'self'", "data:", "blob:", "https://"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
    },
  },
}));
app.use(cors({
  origin: FRONTEND_URL ? [FRONTEND_URL] : true,
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/credits', creditsRoutes);
app.use('/api/history/payment', paymentHistoryRoutes);
app.use('/api/history/transaction', transactionHistoryRoutes);
app.use('/api/offices', officesRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/tripay', tripayCallbackRoutes);
app.use('/api/users', usersRoutes);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Serve static frontend in production (Docker)
if (IS_PRODUCTION) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicPath = path.resolve(__dirname, '../public');
  app.use(express.static(publicPath));
  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
} else {
  // 404 handler (dev mode — frontend served by Vite)
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
}

const DEFAULT_PORT = parseInt(process.env.BACKEND_PORT || '0', 10);

if (!DEFAULT_PORT) {
  console.error('❌ BACKEND_PORT environment variable is required');
  process.exit(1);
}
app.listen(DEFAULT_PORT, () => {
  console.log(`🚀 Clawmpany server running on http://localhost:${DEFAULT_PORT}`);
  console.log(`📡 API endpoints:`);
  console.log(`   - http://localhost:${DEFAULT_PORT}/api/credits`);
  console.log(`   - http://localhost:${DEFAULT_PORT}/api/offices`);
  console.log(`   - http://localhost:${DEFAULT_PORT}/api/payment`);
  console.log(`   - http://localhost:${DEFAULT_PORT}/api/servers`);
  console.log(`   - http://localhost:${DEFAULT_PORT}/api/history/payment`);
  console.log(`   - http://localhost:${DEFAULT_PORT}/api/history/transaction`);
  console.log(`📦 Database: Supabase (${DB_URL})`);
});
