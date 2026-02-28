/**
 * EAM (Enhanced Active Memory) file parser for replay system.
 *
 * Parses YAML-header markdown files to extract replay-relevant data:
 * date, constructs involved, epic, and session summary (anchor).
 */

import { readFile, readdir } from 'fs/promises'
import { join, extname } from 'path'

export interface ReplayEvent {
  constructName: string
  /** Building ID from TOWN_BUILDINGS this construct should walk to */
  buildingId: string | null
  /** Event type — currently always 'work' */
  type: 'work'
}

export interface ReplaySession {
  filename: string
  date: string | null
  epic: string | null
  constructs: string[]
  anchor: string | null
  events: ReplayEvent[]
}

export interface ReplaySessionSummary {
  filename: string
  date: string | null
  epic: string | null
  constructs: string[]
  anchor: string | null
}

/** Map construct names to their building IDs (matches TOWN_BUILDINGS in defaultTownLayout.ts) */
const CONSTRUCT_BUILDING_MAP: Record<string, string> = {
  'Mark95': 'town_hall',
  'LoreForged': 'origin_hall',
  'Athena': 'athena_chambers',
  'Lena': 'lena_cathedral',
  'Keeper': 'keeper_archive',
  'Echolumen': 'resonance_chamber',
  'CORE': 'foundry',
  'Pyrosage': 'pyrosage_hearth',
  'Cadence': 'cadence_office',
  'Venture': 'venture_office',
  'Swiftquill': 'quill_desk',
  'Glasswright': 'glass_workshop',
}

/**
 * Parse a single EAM markdown file into a ReplaySession.
 *
 * Expected header format (blockquote or bold lines at top):
 *   > **Date:** 2026-02-25
 *   > **Epic:** EPIC-DISCO-29
 *   > **Constructs:** Cadence, LoreForged
 *
 * Or non-blockquote:
 *   **Date:** 2026-02-25
 *   **Constructs:** Cadence, LoreForged
 */
export function parseEamFile(content: string, filename: string): ReplaySession {
  const lines = content.split('\n')

  let date: string | null = null
  let epic: string | null = null
  let constructs: string[] = []
  let anchor: string | null = null

  // Only scan the first 30 lines for header fields
  const headerLines = lines.slice(0, 30)
  for (const line of headerLines) {
    // Strip blockquote prefix and trim
    const clean = line.replace(/^>\s*/, '').trim()

    // Date: match **Date:** or TS: patterns
    const dateMatch = clean.match(/\*\*Date:\*\*\s*(.+)/i) || clean.match(/^TS:\s*(.+)/i)
    if (dateMatch && !date) {
      date = dateMatch[1].trim()
    }

    // Epic
    const epicMatch = clean.match(/\*\*Epic:\*\*\s*(.+)/i)
    if (epicMatch && !epic) {
      epic = epicMatch[1].trim()
    }

    // Constructs
    const constructMatch = clean.match(/\*\*Constructs?:\*\*\s*(.+)/i)
    if (constructMatch) {
      const raw = constructMatch[1].trim()
      // Filter out "None mounted" or similar
      if (!/^none/i.test(raw) && !/^n\/a/i.test(raw)) {
        constructs = raw
          .split(/[,;]+/)
          .map(s => s.replace(/\(.*?\)/g, '').trim()) // strip parenthetical notes
          .filter(s => s.length > 0 && !/^none/i.test(s))
      }
    }
  }

  // Try to extract anchor/summary from ## Narrative or first paragraph after ---
  const narrativeIdx = lines.findIndex(l => /^##\s*Narrative/i.test(l.trim()))
  if (narrativeIdx >= 0) {
    // Grab the first non-empty line after the heading
    for (let i = narrativeIdx + 1; i < Math.min(narrativeIdx + 5, lines.length); i++) {
      const trimmed = lines[i].trim()
      if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
        anchor = trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed
        break
      }
    }
  }

  // Build replay events — one per construct
  const events: ReplayEvent[] = constructs.map(name => ({
    constructName: name,
    buildingId: CONSTRUCT_BUILDING_MAP[name] ?? null,
    type: 'work' as const,
  }))

  return { filename, date, epic, constructs, anchor, events }
}

/**
 * List all EAM files in a directory and parse their headers for summaries.
 */
export async function listEamSessions(eamDir: string): Promise<ReplaySessionSummary[]> {
  let files: string[]
  try {
    files = await readdir(eamDir)
  } catch {
    return []
  }

  const eamFiles = files
    .filter(f => extname(f) === '.md' && f.startsWith('MAG_'))
    .sort()
    .reverse() // newest first (highest number)

  const summaries: ReplaySessionSummary[] = []
  for (const filename of eamFiles) {
    try {
      const content = await readFile(join(eamDir, filename), 'utf-8')
      const session = parseEamFile(content, filename)
      summaries.push({
        filename: session.filename,
        date: session.date,
        epic: session.epic,
        constructs: session.constructs,
        anchor: session.anchor,
      })
    } catch {
      // Skip unreadable files
    }
  }

  return summaries
}

/**
 * Parse a single EAM file by filename from the EAM directory.
 */
export async function getEamSession(eamDir: string, filename: string): Promise<ReplaySession | null> {
  // Sanitize filename to prevent directory traversal
  const safe = filename.replace(/[/\\]/g, '')
  if (safe !== filename || !filename.endsWith('.md')) return null

  try {
    const content = await readFile(join(eamDir, safe), 'utf-8')
    return parseEamFile(content, safe)
  } catch {
    return null
  }
}
