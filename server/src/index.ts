// Load environment variables FIRST before any other imports
import './env.js';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { creditsRoutes } from './routes/credits.js';
import { officesRoutes } from './routes/offices.js';
import { paymentRoutes } from './routes/payment.js';
import { paymentHistoryRoutes } from './routes/paymentHistory.js';
import { serverRoutes } from './routes/servers.js';
import { transactionHistoryRoutes } from './routes/transactionHistory.js';
import { tripayCallbackRoutes } from './routes/tripayCallback.js';

const app = express();
const PORT = process.env.PORT || 3001;
const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'https://clawmpany.id',
    'https://www.clawmpany.id',
  ],
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

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Clawmpany server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints:`);
  console.log(`   - http://localhost:${PORT}/api/credits`);
  console.log(`   - http://localhost:${PORT}/api/offices`);
  console.log(`   - http://localhost:${PORT}/api/payment`);
  console.log(`   - http://localhost:${PORT}/api/servers`);
  console.log(`   - http://localhost:${PORT}/api/history/payment`);
  console.log(`   - http://localhost:${PORT}/api/history/transaction`);
  console.log(`📦 PocketBase: ${POCKETBASE_URL}`);
});
