import { Router } from 'express'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const router = Router()

// Town memory lives in data/town_memory/ relative to project root
const MEMORY_DIR = join(import.meta.dirname, '../../../data/town_memory')

interface Interaction {
  date: string
  greeting_used: string
  dialogue_shown: string
}

interface ConstructMemory {
  construct: string
  last_interaction_date: string | null
  interaction_count: number
  last_topic: string | null
  mood: string | null
  interactions: Interaction[]
}

function createEmptyMemory(construct: string): ConstructMemory {
  return {
    construct,
    last_interaction_date: null,
    interaction_count: 0,
    last_topic: null,
    mood: null,
    interactions: [],
  }
}

// GET /api/memory/:construct — Read a construct's interaction memory
router.get('/:construct', async (req, res) => {
  const { construct } = req.params
  const filePath = join(MEMORY_DIR, `${construct}.json`)

  if (!existsSync(filePath)) {
    res.json(createEmptyMemory(construct))
    return
  }

  const data = await readFile(filePath, 'utf-8')
  res.json(JSON.parse(data))
})

// POST /api/memory/:construct/interact — Log a new interaction
router.post('/:construct/interact', async (req, res) => {
  const { construct } = req.params
  const { greeting_used, dialogue_shown, topic } = req.body as {
    greeting_used: string
    dialogue_shown: string
    topic?: string
  }

  const filePath = join(MEMORY_DIR, `${construct}.json`)

  // Ensure directory exists
  if (!existsSync(MEMORY_DIR)) {
    await mkdir(MEMORY_DIR, { recursive: true })
  }

  // Read existing or create new
  let memory: ConstructMemory
  if (existsSync(filePath)) {
    const data = await readFile(filePath, 'utf-8')
    memory = JSON.parse(data)
  } else {
    memory = createEmptyMemory(construct)
  }

  // Update memory
  const now = new Date().toISOString()
  memory.last_interaction_date = now
  memory.interaction_count += 1
  if (topic) {
    memory.last_topic = topic
  }

  // Add interaction record (keep last 50)
  memory.interactions.push({
    date: now,
    greeting_used,
    dialogue_shown,
  })
  if (memory.interactions.length > 50) {
    memory.interactions = memory.interactions.slice(-50)
  }

  await writeFile(filePath, JSON.stringify(memory, null, 2), 'utf-8')
  res.json(memory)
})

// GET /api/memory — List all construct memories
router.get('/', async (_req, res) => {
  if (!existsSync(MEMORY_DIR)) {
    res.json([])
    return
  }

  const { readdir } = await import('fs/promises')
  const files = await readdir(MEMORY_DIR)
  const memories = await Promise.all(
    files
      .filter((f: string) => f.endsWith('.json'))
      .map(async (f: string) => {
        const data = await readFile(join(MEMORY_DIR, f), 'utf-8')
        return JSON.parse(data) as ConstructMemory
      })
  )
  res.json(memories)
})

export { router as townMemoryRouter }
