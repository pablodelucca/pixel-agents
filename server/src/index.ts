// Load environment variables FIRST before any other imports
import './env.js';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { officesRoutes } from './routes/offices.js';
import { serverRoutes } from './routes/servers.js';
import { sessionsRoutes } from './routes/sessions.js';

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
  ],
  credentials: true,
}));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/offices', officesRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/servers/:serverId/sessions', sessionsRoutes);

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
  console.log(`   - http://localhost:${PORT}/api/offices`);
  console.log(`   - http://localhost:${PORT}/api/servers`);
  console.log(`📦 PocketBase: ${POCKETBASE_URL}`);
});
