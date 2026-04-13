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

const app = express();
const DB_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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

const DEFAULT_PORT = parseInt(process.env.PORT || '3001', 10);
const MAX_ATTEMPTS = 10;

function tryListen(port: number, attemptsLeft: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.on('listening', () => {
      if (port !== DEFAULT_PORT) {
        console.log(`⚠️  Port ${DEFAULT_PORT} is in use, switched to ${port}`);
      }
      console.log(`🚀 Clawmpany server running on http://localhost:${port}`);
      console.log(`📡 API endpoints:`);
      console.log(`   - http://localhost:${port}/api/credits`);
      console.log(`   - http://localhost:${port}/api/offices`);
      console.log(`   - http://localhost:${port}/api/payment`);
      console.log(`   - http://localhost:${port}/api/servers`);
      console.log(`   - http://localhost:${port}/api/history/payment`);
      console.log(`   - http://localhost:${port}/api/history/transaction`);
      console.log(`📦 Database: ${DB_URL}`);
      resolve(port);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        server.close();
        resolve(tryListen(port + 1, attemptsLeft - 1));
      } else {
        reject(err);
      }
    });
  });
}

tryListen(DEFAULT_PORT, MAX_ATTEMPTS).catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
