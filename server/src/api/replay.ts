/**
 * Replay API routes — serves parsed EAM session data for town playback.
 *
 * GET /api/replay/sessions          — List available EAM sessions (summaries)
 * GET /api/replay/sessions/:filename — Get full parsed replay events for one session
 */

import { Router } from 'express'
import { listEamSessions, getEamSession } from './eamParser.js'

const router = Router()

// Default EAM directory — configurable via EAM_DIR env var
const EAM_DIR = process.env['EAM_DIR'] ?? 'C:\\CrystallineCity\\claudecode\\ClaudeFiles\\Magistrate\\EAM'

// GET /api/replay/sessions
router.get('/sessions', async (_req, res) => {
  const sessions = await listEamSessions(EAM_DIR)
  res.json(sessions)
})

// GET /api/replay/sessions/:filename
router.get('/sessions/:filename', async (req, res) => {
  const { filename } = req.params
  if (!filename) {
    res.status(400).json({ error: 'Missing filename parameter' })
    return
  }
  const session = await getEamSession(EAM_DIR, filename)
  if (!session) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  res.json(session)
})

export { router as replayRouter }
