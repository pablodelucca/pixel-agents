import express from 'express'
import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { townMemoryRouter } from './api/townMemory.js'
import { townDataRouter } from './api/townData.js'
import { replayRouter } from './api/replay.js'

const PORT = 3001
const app = express()
const server = createServer(app)

// WebSocket server for live filesystem watcher events
const wss = new WebSocketServer({ server, path: '/ws' })

app.use(express.json())

// CORS for Vite dev server
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

// API routes
app.use('/api/memory', townMemoryRouter)
app.use('/api/town', townDataRouter)
app.use('/api/replay', replayRouter)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'PixelCity Server' })
})

wss.on('connection', (ws) => {
  console.log('[WS] Client connected')
  ws.on('close', () => console.log('[WS] Client disconnected'))
})

server.listen(PORT, () => {
  console.log(`[PixelCity] Server running on http://localhost:${PORT}`)
  console.log(`[PixelCity] WebSocket on ws://localhost:${PORT}/ws`)
})

export { wss }
