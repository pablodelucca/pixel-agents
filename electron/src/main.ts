import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { PNG } from 'pngjs'
import { loadSettings, setSetting } from './store'
import { launchClaude, killProcess, killAllProcesses } from './processManager'

// ── Constants (mirror src/constants.ts) ─────────────────────
const PNG_ALPHA_THRESHOLD = 128
const WALL_PIECE_WIDTH = 16
const WALL_PIECE_HEIGHT = 32
const WALL_GRID_COLS = 4
const WALL_BITMASK_COUNT = 16
const FLOOR_TILE_SIZE = 16
const FLOOR_PATTERN_COUNT = 7
const CHAR_FRAME_W = 16
const CHAR_FRAME_H = 32
const CHAR_FRAMES_PER_ROW = 7
const CHAR_COUNT = 6
const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const

const LAYOUT_FILE_DIR = '.pixel-agents'
const LAYOUT_FILE_NAME = 'layout.json'
const LAYOUT_FILE_POLL_INTERVAL_MS = 2000

const JSONL_POLL_INTERVAL_MS = 1000
const FILE_WATCHER_POLL_INTERVAL_MS = 1000
const TOOL_DONE_DELAY_MS = 300
const PERMISSION_TIMER_DELAY_MS = 7000
const TEXT_IDLE_DELAY_MS = 5000
const EXTERNAL_SESSION_SCAN_INTERVAL_MS = 3000
const EXTERNAL_SESSION_STALE_THRESHOLD_MS = 30_000
const EXTERNAL_SESSION_REMOVE_THRESHOLD_MS = 300_000

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion'])
const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30
const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40

// ── Types ───────────────────────────────────────────────────
type SpriteData = string[][]

interface MessageEmitter {
  postMessage(msg: unknown): void
}

interface AgentState {
  id: number
  isExternal: boolean
  projectDir: string
  jsonlFile: string
  fileOffset: number
  lineBuffer: string
  activeToolIds: Set<string>
  activeToolStatuses: Map<string, string>
  activeToolNames: Map<string, string>
  activeSubagentToolIds: Map<string, Set<string>>
  activeSubagentToolNames: Map<string, Map<string, string>>
  isWaiting: boolean
  permissionSent: boolean
  hadToolsInTurn: boolean
  folderName?: string
}

// ── Global State ────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
const agents = new Map<number, AgentState>()
let nextAgentId = 1
const knownJsonlFiles = new Set<string>()

const fileWatchers = new Map<number, fs.FSWatcher>()
const pollingTimers = new Map<number, ReturnType<typeof setInterval>>()
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>()
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>()
const jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>()
let externalScanTimer: ReturnType<typeof setInterval> | null = null
const externalTrackedFiles = new Map<string, number>()

let layoutWatchTimer: ReturnType<typeof setInterval> | null = null
let lastLayoutMtime = 0

// ── MessageEmitter for main window ──────────────────────────
function getEmitter(): MessageEmitter | undefined {
  if (!mainWindow || mainWindow.isDestroyed()) return undefined
  return {
    postMessage(msg: unknown) {
      mainWindow!.webContents.send('extension-message', msg)
    },
  }
}

// ── Layout Persistence ──────────────────────────────────────
const layoutDir = path.join(os.homedir(), LAYOUT_FILE_DIR)
const layoutFilePath = path.join(layoutDir, LAYOUT_FILE_NAME)

function readLayoutFromFile(): Record<string, unknown> | null {
  try {
    if (fs.existsSync(layoutFilePath)) {
      const raw = fs.readFileSync(layoutFilePath, 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    }
  } catch { /* ignore */ }
  return null
}

function writeLayoutToFile(layout: Record<string, unknown>): void {
  try {
    if (!fs.existsSync(layoutDir)) {
      fs.mkdirSync(layoutDir, { recursive: true })
    }
    const tmpFile = layoutFilePath + '.tmp'
    fs.writeFileSync(tmpFile, JSON.stringify(layout, null, 2), 'utf-8')
    fs.renameSync(tmpFile, layoutFilePath)
    try {
      lastLayoutMtime = fs.statSync(layoutFilePath).mtimeMs
    } catch { /* ignore */ }
  } catch (err) {
    console.error('[Pixel Agents] Failed to write layout:', err)
  }
}

function startLayoutWatcher(): void {
  if (layoutWatchTimer) return
  try {
    lastLayoutMtime = fs.existsSync(layoutFilePath) ? fs.statSync(layoutFilePath).mtimeMs : 0
  } catch { /* ignore */ }

  layoutWatchTimer = setInterval(() => {
    try {
      if (!fs.existsSync(layoutFilePath)) return
      const stat = fs.statSync(layoutFilePath)
      if (stat.mtimeMs > lastLayoutMtime) {
        lastLayoutMtime = stat.mtimeMs
        const layout = readLayoutFromFile()
        if (layout) {
          getEmitter()?.postMessage({ type: 'layoutLoaded', layout })
        }
      }
    } catch { /* ignore */ }
  }, LAYOUT_FILE_POLL_INTERVAL_MS)
}

// ── PNG Loading ─────────────────────────────────────────────
function pngToSpriteData(pngPath: string): SpriteData | null {
  try {
    const data = fs.readFileSync(pngPath)
    const png = PNG.sync.read(data)
    const sprite: SpriteData = []
    for (let y = 0; y < png.height; y++) {
      const row: string[] = []
      for (let x = 0; x < png.width; x++) {
        const idx = (y * png.width + x) * 4
        const a = png.data[idx + 3]
        if (a < PNG_ALPHA_THRESHOLD) {
          row.push('')
        } else {
          const r = png.data[idx].toString(16).padStart(2, '0')
          const g = png.data[idx + 1].toString(16).padStart(2, '0')
          const b = png.data[idx + 2].toString(16).padStart(2, '0')
          row.push(`#${r}${g}${b}`)
        }
      }
      sprite.push(row)
    }
    return sprite
  } catch {
    return null
  }
}

function extractRegion(sprite: SpriteData, x: number, y: number, w: number, h: number): SpriteData {
  const region: SpriteData = []
  for (let r = y; r < y + h && r < sprite.length; r++) {
    const row: string[] = []
    for (let c = x; c < x + w && c < (sprite[r]?.length ?? 0); c++) {
      row.push(sprite[r][c])
    }
    region.push(row)
  }
  return region
}

// ── Asset Loading ───────────────────────────────────────────
function findAssetsRoot(): string | null {
  // In packaged app: resources/assets
  const resourcesPath = path.join(process.resourcesPath || '', 'assets')
  if (fs.existsSync(resourcesPath)) return path.dirname(resourcesPath)

  // Development: webview-ui/public/assets
  const devPath = path.join(__dirname, '..', '..', 'webview-ui', 'public', 'assets')
  if (fs.existsSync(devPath)) return path.join(__dirname, '..', '..', 'webview-ui', 'public')

  // Also try dist/assets (built extension location)
  const distPath = path.join(__dirname, '..', '..', 'dist', 'assets')
  if (fs.existsSync(distPath)) return path.join(__dirname, '..', '..', 'dist')

  return null
}

async function loadAndSendAssets(emitter: MessageEmitter, assetsRoot: string): Promise<void> {
  const assetsDir = path.join(assetsRoot, 'assets')

  // Character sprites
  const charDir = path.join(assetsDir, 'characters')
  if (fs.existsSync(charDir)) {
    const characters: Array<{ down: SpriteData[]; up: SpriteData[]; right: SpriteData[] }> = []
    for (let i = 0; i < CHAR_COUNT; i++) {
      const charFile = path.join(charDir, `char_${i}.png`)
      const fullSprite = pngToSpriteData(charFile)
      if (!fullSprite) continue

      const dirSprites: { down: SpriteData[]; up: SpriteData[]; right: SpriteData[] } = { down: [], up: [], right: [] }
      for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
        const dir = CHARACTER_DIRECTIONS[dirIdx]
        const frames: SpriteData[] = []
        for (let frame = 0; frame < CHAR_FRAMES_PER_ROW; frame++) {
          frames.push(extractRegion(fullSprite, frame * CHAR_FRAME_W, dirIdx * CHAR_FRAME_H, CHAR_FRAME_W, CHAR_FRAME_H))
        }
        dirSprites[dir] = frames
      }
      characters.push(dirSprites)
    }
    if (characters.length > 0) {
      emitter.postMessage({ type: 'characterSpritesLoaded', characters })
    }
  }

  // Floor tiles
  const floorsFile = path.join(assetsDir, 'floors.png')
  if (fs.existsSync(floorsFile)) {
    const fullSprite = pngToSpriteData(floorsFile)
    if (fullSprite) {
      const sprites: SpriteData[] = []
      for (let i = 0; i < FLOOR_PATTERN_COUNT; i++) {
        sprites.push(extractRegion(fullSprite, i * FLOOR_TILE_SIZE, 0, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE))
      }
      emitter.postMessage({ type: 'floorTilesLoaded', sprites })
    }
  }

  // Wall tiles
  const wallsFile = path.join(assetsDir, 'walls.png')
  if (fs.existsSync(wallsFile)) {
    const fullSprite = pngToSpriteData(wallsFile)
    if (fullSprite) {
      const sprites: SpriteData[] = []
      for (let i = 0; i < WALL_BITMASK_COUNT; i++) {
        const col = i % WALL_GRID_COLS
        const row = Math.floor(i / WALL_GRID_COLS)
        sprites.push(extractRegion(fullSprite, col * WALL_PIECE_WIDTH, row * WALL_PIECE_HEIGHT, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT))
      }
      emitter.postMessage({ type: 'wallTilesLoaded', sprites })
    }
  }

  // Furniture assets
  const furnitureDir = path.join(assetsDir, 'furniture')
  const catalogFile = path.join(furnitureDir, 'furniture-catalog.json')
  if (fs.existsSync(catalogFile)) {
    try {
      const catalogRaw = fs.readFileSync(catalogFile, 'utf-8')
      const catalog = JSON.parse(catalogRaw) as Array<{ file: string; [key: string]: unknown }>
      const sprites: Record<string, SpriteData> = {}

      for (const entry of catalog) {
        const pngFile = path.join(furnitureDir, entry.file)
        const sprite = pngToSpriteData(pngFile)
        if (sprite) {
          const id = path.basename(entry.file, '.png')
          sprites[id] = sprite
        }
      }

      emitter.postMessage({ type: 'furnitureAssetsLoaded', catalog, sprites })
    } catch (err) {
      console.error('[Pixel Agents] Failed to load furniture catalog:', err)
    }
  }

  // Layout
  let layout = readLayoutFromFile()
  if (!layout) {
    const defaultLayoutFile = path.join(assetsDir, 'default-layout.json')
    if (fs.existsSync(defaultLayoutFile)) {
      try {
        const raw = fs.readFileSync(defaultLayoutFile, 'utf-8')
        layout = JSON.parse(raw) as Record<string, unknown>
        writeLayoutToFile(layout)
      } catch { /* ignore */ }
    }
  }
  emitter.postMessage({ type: 'layoutLoaded', layout })
}

// ── JSONL Transcript Parsing ────────────────────────────────
function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : ''
  switch (toolName) {
    case 'Read': return `Reading ${base(input.file_path)}`
    case 'Edit': return `Editing ${base(input.file_path)}`
    case 'Write': return `Writing ${base(input.file_path)}`
    case 'Bash': {
      const cmd = (input.command as string) || ''
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`
    }
    case 'Glob': return 'Searching files'
    case 'Grep': return 'Searching code'
    case 'WebFetch': return 'Fetching web content'
    case 'WebSearch': return 'Searching the web'
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : ''
      return desc ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running subtask'
    }
    case 'AskUserQuestion': return 'Waiting for your answer'
    case 'EnterPlanMode': return 'Planning'
    case 'NotebookEdit': return 'Editing notebook'
    default: return `Using ${toolName}`
  }
}

// ── Timer Management ────────────────────────────────────────
function cancelTimer(id: number, timers: Map<number, ReturnType<typeof setTimeout>>): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
}

function clearAgentActivity(agent: AgentState, agentId: number): void {
  agent.activeToolIds.clear()
  agent.activeToolStatuses.clear()
  agent.activeToolNames.clear()
  agent.activeSubagentToolIds.clear()
  agent.activeSubagentToolNames.clear()
  agent.isWaiting = false
  agent.permissionSent = false
  cancelTimer(agentId, permissionTimers)
  const emitter = getEmitter()
  emitter?.postMessage({ type: 'agentToolsClear', id: agentId })
  emitter?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' })
}

function startPermissionTimer(agentId: number): void {
  cancelTimer(agentId, permissionTimers)
  const timer = setTimeout(() => {
    permissionTimers.delete(agentId)
    const agent = agents.get(agentId)
    if (!agent) return

    let hasNonExempt = false
    for (const toolId of agent.activeToolIds) {
      const toolName = agent.activeToolNames.get(toolId)
      if (!PERMISSION_EXEMPT_TOOLS.has(toolName || '')) {
        hasNonExempt = true
        break
      }
    }

    const stuckSubagentParentToolIds: string[] = []
    for (const [parentToolId, subToolNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subToolNames) {
        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
          stuckSubagentParentToolIds.push(parentToolId)
          hasNonExempt = true
          break
        }
      }
    }

    if (hasNonExempt) {
      agent.permissionSent = true
      const emitter = getEmitter()
      emitter?.postMessage({ type: 'agentToolPermission', id: agentId })
      for (const parentToolId of stuckSubagentParentToolIds) {
        emitter?.postMessage({ type: 'subagentToolPermission', id: agentId, parentToolId })
      }
    }
  }, PERMISSION_TIMER_DELAY_MS)
  permissionTimers.set(agentId, timer)
}

// ── JSONL Processing ────────────────────────────────────────
function processTranscriptLine(agentId: number, line: string): void {
  const agent = agents.get(agentId)
  if (!agent) return
  const emitter = getEmitter()

  try {
    const record = JSON.parse(line)

    if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
      const blocks = record.message.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>
      const hasToolUse = blocks.some((b: { type: string }) => b.type === 'tool_use')

      if (hasToolUse) {
        cancelTimer(agentId, waitingTimers)
        agent.isWaiting = false
        agent.hadToolsInTurn = true
        emitter?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' })

        let hasNonExemptTool = false
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id) {
            const toolName = block.name || ''
            const status = formatToolStatus(toolName, block.input || {})
            agent.activeToolIds.add(block.id)
            agent.activeToolStatuses.set(block.id, status)
            agent.activeToolNames.set(block.id, toolName)
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExemptTool = true
            emitter?.postMessage({ type: 'agentToolStart', id: agentId, toolId: block.id, status })
          }
        }
        if (hasNonExemptTool) startPermissionTimer(agentId)
      } else if (blocks.some((b: { type: string }) => b.type === 'text') && !agent.hadToolsInTurn) {
        cancelTimer(agentId, waitingTimers)
        const timer = setTimeout(() => {
          waitingTimers.delete(agentId)
          const a = agents.get(agentId)
          if (a) a.isWaiting = true
          getEmitter()?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' })
        }, TEXT_IDLE_DELAY_MS)
        waitingTimers.set(agentId, timer)
      }
    } else if (record.type === 'progress') {
      processProgressRecord(agentId, record)
    } else if (record.type === 'user') {
      const content = record.message?.content
      if (Array.isArray(content)) {
        const hasToolResult = content.some((b: { type: string }) => b.type === 'tool_result')
        if (hasToolResult) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const completedToolId = block.tool_use_id as string
              if (agent.activeToolNames.get(completedToolId) === 'Task') {
                agent.activeSubagentToolIds.delete(completedToolId)
                agent.activeSubagentToolNames.delete(completedToolId)
                emitter?.postMessage({ type: 'subagentClear', id: agentId, parentToolId: completedToolId })
              }
              agent.activeToolIds.delete(completedToolId)
              agent.activeToolStatuses.delete(completedToolId)
              agent.activeToolNames.delete(completedToolId)
              const toolId = completedToolId
              setTimeout(() => {
                getEmitter()?.postMessage({ type: 'agentToolDone', id: agentId, toolId })
              }, TOOL_DONE_DELAY_MS)
            }
          }
          if (agent.activeToolIds.size === 0) agent.hadToolsInTurn = false
        } else {
          cancelTimer(agentId, waitingTimers)
          clearAgentActivity(agent, agentId)
          agent.hadToolsInTurn = false
        }
      } else if (typeof content === 'string' && content.trim()) {
        cancelTimer(agentId, waitingTimers)
        clearAgentActivity(agent, agentId)
        agent.hadToolsInTurn = false
      }
    } else if (record.type === 'system' && record.subtype === 'turn_duration') {
      cancelTimer(agentId, waitingTimers)
      cancelTimer(agentId, permissionTimers)
      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear()
        agent.activeToolStatuses.clear()
        agent.activeToolNames.clear()
        agent.activeSubagentToolIds.clear()
        agent.activeSubagentToolNames.clear()
        emitter?.postMessage({ type: 'agentToolsClear', id: agentId })
      }
      agent.isWaiting = true
      agent.permissionSent = false
      agent.hadToolsInTurn = false
      emitter?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' })
    }
  } catch { /* Ignore malformed lines */ }
}

function processProgressRecord(agentId: number, record: Record<string, unknown>): void {
  const agent = agents.get(agentId)
  if (!agent) return
  const emitter = getEmitter()

  const parentToolId = record.parentToolUseID as string | undefined
  if (!parentToolId) return

  const data = record.data as Record<string, unknown> | undefined
  if (!data) return

  const dataType = data.type as string | undefined
  if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
    if (agent.activeToolIds.has(parentToolId)) startPermissionTimer(agentId)
    return
  }

  if (agent.activeToolNames.get(parentToolId) !== 'Task') return

  const msg = data.message as Record<string, unknown> | undefined
  if (!msg) return

  const msgType = msg.type as string
  const innerMsg = msg.message as Record<string, unknown> | undefined
  const content = innerMsg?.content
  if (!Array.isArray(content)) return

  if (msgType === 'assistant') {
    let hasNonExemptSubTool = false
    for (const block of content) {
      if (block.type === 'tool_use' && block.id) {
        const toolName = block.name || ''
        const status = formatToolStatus(toolName, block.input || {})

        let subTools = agent.activeSubagentToolIds.get(parentToolId)
        if (!subTools) { subTools = new Set(); agent.activeSubagentToolIds.set(parentToolId, subTools) }
        subTools.add(block.id)

        let subNames = agent.activeSubagentToolNames.get(parentToolId)
        if (!subNames) { subNames = new Map(); agent.activeSubagentToolNames.set(parentToolId, subNames) }
        subNames.set(block.id, toolName)

        if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExemptSubTool = true
        emitter?.postMessage({ type: 'subagentToolStart', id: agentId, parentToolId, toolId: block.id, status })
      }
    }
    if (hasNonExemptSubTool) startPermissionTimer(agentId)
  } else if (msgType === 'user') {
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        const subTools = agent.activeSubagentToolIds.get(parentToolId)
        if (subTools) subTools.delete(block.tool_use_id)
        const subNames = agent.activeSubagentToolNames.get(parentToolId)
        if (subNames) subNames.delete(block.tool_use_id)

        const toolId = block.tool_use_id as string
        setTimeout(() => {
          getEmitter()?.postMessage({ type: 'subagentToolDone', id: agentId, parentToolId, toolId })
        }, TOOL_DONE_DELAY_MS)
      }
    }
  }
}

// ── File Watching ───────────────────────────────────────────
function readNewLines(agentId: number): void {
  const agent = agents.get(agentId)
  if (!agent) return
  const emitter = getEmitter()

  try {
    const stat = fs.statSync(agent.jsonlFile)
    if (stat.size <= agent.fileOffset) return

    const buf = Buffer.alloc(stat.size - agent.fileOffset)
    const fd = fs.openSync(agent.jsonlFile, 'r')
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset)
    fs.closeSync(fd)
    agent.fileOffset = stat.size

    const text = agent.lineBuffer + buf.toString('utf-8')
    const lines = text.split('\n')
    agent.lineBuffer = lines.pop() || ''

    const hasLines = lines.some(l => l.trim())
    if (hasLines) {
      cancelTimer(agentId, waitingTimers)
      cancelTimer(agentId, permissionTimers)
      if (agent.permissionSent) {
        agent.permissionSent = false
        emitter?.postMessage({ type: 'agentToolPermissionClear', id: agentId })
      }
    }

    for (const line of lines) {
      if (!line.trim()) continue
      processTranscriptLine(agentId, line)
    }
  } catch { /* Read error, ignore */ }
}

function startFileWatching(agentId: number, filePath: string): void {
  try {
    const watcher = fs.watch(filePath, () => readNewLines(agentId))
    fileWatchers.set(agentId, watcher)
  } catch { /* fs.watch may fail */ }

  try {
    fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => readNewLines(agentId))
  } catch { /* ignore */ }

  const interval = setInterval(() => {
    if (!agents.has(agentId)) {
      clearInterval(interval)
      try { fs.unwatchFile(filePath) } catch { /* ignore */ }
      return
    }
    readNewLines(agentId)
  }, FILE_WATCHER_POLL_INTERVAL_MS)
  pollingTimers.set(agentId, interval)
}

function removeAgent(agentId: number): void {
  const agent = agents.get(agentId)
  if (!agent) return

  const jpTimer = jsonlPollTimers.get(agentId)
  if (jpTimer) clearInterval(jpTimer)
  jsonlPollTimers.delete(agentId)

  fileWatchers.get(agentId)?.close()
  fileWatchers.delete(agentId)
  const pt = pollingTimers.get(agentId)
  if (pt) clearInterval(pt)
  pollingTimers.delete(agentId)
  try { fs.unwatchFile(agent.jsonlFile) } catch { /* ignore */ }

  cancelTimer(agentId, waitingTimers)
  cancelTimer(agentId, permissionTimers)

  agents.delete(agentId)
}

// ── External Session Scanner ────────────────────────────────
const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects')

function runExternalScan(): void {
  const now = Date.now()
  const emitter = getEmitter()

  const dirsToScan: string[] = []
  try {
    const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirsToScan.push(path.join(claudeProjectsDir, entry.name))
      }
    }
  } catch { /* ~/.claude/projects may not exist */ }

  const activeFiles = new Set<string>()
  for (const dir of dirsToScan) {
    try {
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => path.join(dir, f))

      for (const file of files) {
        if (knownJsonlFiles.has(file)) continue

        try {
          const stat = fs.statSync(file)
          const age = now - stat.mtimeMs

          if (age < EXTERNAL_SESSION_STALE_THRESHOLD_MS) {
            activeFiles.add(file)

            if (!externalTrackedFiles.has(file)) {
              const id = nextAgentId++
              // Derive a readable folder name from the project dir name
              const dirBaseName = path.basename(dir)
              const decodedPath = dirBaseName.replace(/^-/, '/').replace(/-/g, '/')
              const home = os.homedir()
              const folderName = decodedPath.startsWith(home)
                ? decodedPath.slice(home.length + 1)
                : decodedPath

              const agent: AgentState = {
                id,
                isExternal: true,
                projectDir: dir,
                jsonlFile: file,
                fileOffset: stat.size,
                lineBuffer: '',
                activeToolIds: new Set(),
                activeToolStatuses: new Map(),
                activeToolNames: new Map(),
                activeSubagentToolIds: new Map(),
                activeSubagentToolNames: new Map(),
                isWaiting: false,
                permissionSent: false,
                hadToolsInTurn: false,
                folderName,
              }

              agents.set(id, agent)
              externalTrackedFiles.set(file, id)
              console.log(`[Pixel Agents] External agent ${id}: tracking ${path.basename(file)}`)
              const projectId = path.basename(dir)
              emitter?.postMessage({ type: 'agentCreated', id, isExternal: true, folderName, projectId })
              startFileWatching(id, file)
              readNewLines(id)
            }
          } else if (age > EXTERNAL_SESSION_REMOVE_THRESHOLD_MS) {
            const trackedId = externalTrackedFiles.get(file)
            if (trackedId !== undefined) {
              removeAgent(trackedId)
              emitter?.postMessage({ type: 'agentClosed', id: trackedId })
              externalTrackedFiles.delete(file)
            }
          }
        } catch { /* stat error */ }
      }
    } catch { /* dir read error */ }
  }

  for (const [filePath, agentId] of externalTrackedFiles) {
    if (!activeFiles.has(filePath)) {
      try {
        const stat = fs.statSync(filePath)
        if (now - stat.mtimeMs > EXTERNAL_SESSION_REMOVE_THRESHOLD_MS) {
          removeAgent(agentId)
          emitter?.postMessage({ type: 'agentClosed', id: agentId })
          externalTrackedFiles.delete(filePath)
        }
      } catch {
        removeAgent(agentId)
        emitter?.postMessage({ type: 'agentClosed', id: agentId })
        externalTrackedFiles.delete(filePath)
      }
    }
  }
}

function startExternalScan(): void {
  if (externalScanTimer) return
  runExternalScan()
  externalScanTimer = setInterval(runExternalScan, EXTERNAL_SESSION_SCAN_INTERVAL_MS)
}

// ── Agent Launch ────────────────────────────────────────────
function handleOpenClaude(): void {
  const cwd = process.cwd()
  const id = nextAgentId++
  const managed = launchClaude(id, cwd)

  const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-')
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName)
  const jsonlFile = path.join(projectDir, `${managed.sessionId}.jsonl`)

  knownJsonlFiles.add(jsonlFile)

  const agent: AgentState = {
    id,
    isExternal: false,
    projectDir,
    jsonlFile,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
  }

  agents.set(id, agent)
  const projectId = path.basename(projectDir)
  getEmitter()?.postMessage({ type: 'agentCreated', id, projectId })

  // Poll for JSONL file to appear
  const pollTimer = setInterval(() => {
    try {
      if (fs.existsSync(jsonlFile)) {
        clearInterval(pollTimer)
        jsonlPollTimers.delete(id)
        startFileWatching(id, jsonlFile)
        readNewLines(id)
      }
    } catch { /* file may not exist yet */ }
  }, JSONL_POLL_INTERVAL_MS)
  jsonlPollTimers.set(id, pollTimer)
}

// ── IPC Message Handler ─────────────────────────────────────
function setupIPC(): void {
  ipcMain.on('webview-message', async (_event, message: Record<string, unknown>) => {
    const emitter = getEmitter()

    if (message.type === 'openClaude') {
      handleOpenClaude()
    } else if (message.type === 'focusAgent') {
      const agent = agents.get(message.id as number)
      if (agent?.isExternal) {
        // External agents have no terminal to focus
      }
    } else if (message.type === 'closeAgent') {
      const id = message.id as number
      const agent = agents.get(id)
      if (agent) {
        if (!agent.isExternal) killProcess(id)
        removeAgent(id)
        emitter?.postMessage({ type: 'agentClosed', id })
        // Remove from external tracking if applicable
        for (const [file, trackedId] of externalTrackedFiles) {
          if (trackedId === id) { externalTrackedFiles.delete(file); break }
        }
      }
    } else if (message.type === 'saveLayout') {
      writeLayoutToFile(message.layout as Record<string, unknown>)
    } else if (message.type === 'setSoundEnabled') {
      setSetting('soundEnabled', message.enabled as boolean)
    } else if (message.type === 'setShowLabelsAlways') {
      setSetting('showLabelsAlways', message.enabled as boolean)
      emitter?.postMessage({ type: 'settingChanged', key: 'showLabelsAlways', value: message.enabled })
    } else if (message.type === 'webviewReady') {
      const settings = loadSettings()
      emitter?.postMessage({
        type: 'settingsLoaded',
        soundEnabled: settings.soundEnabled,
        showLabelsAlways: settings.showLabelsAlways,
        externalSessionsEnabled: settings.externalSessionsEnabled,
        externalSessionsScope: settings.externalSessionsScope,
      })

      const assetsRoot = findAssetsRoot()
      if (assetsRoot && emitter) {
        await loadAndSendAssets(emitter, assetsRoot)
      } else if (emitter) {
        const layout = readLayoutFromFile()
        emitter.postMessage({ type: 'layoutLoaded', layout })
      }

      // Send existing agents
      const agentIds = [...agents.keys()].sort((a, b) => a - b)
      const folderNames: Record<number, string> = {}
      const externalFlags: Record<number, boolean> = {}
      const projectIds: Record<number, string> = {}
      for (const [id, agent] of agents) {
        if (agent.folderName) folderNames[id] = agent.folderName
        if (agent.isExternal) externalFlags[id] = true
        projectIds[id] = path.basename(agent.projectDir)
      }
      emitter?.postMessage({ type: 'existingAgents', agents: agentIds, agentMeta: {}, folderNames, externalFlags, projectIds })

      startLayoutWatcher()
      startExternalScan()
    } else if (message.type === 'exportLayout') {
      const layout = readLayoutFromFile()
      if (!layout) return
      const result = await dialog.showSaveDialog(mainWindow!, {
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        defaultPath: path.join(os.homedir(), 'pixel-agents-layout.json'),
      })
      if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, JSON.stringify(layout, null, 2), 'utf-8')
      }
    } else if (message.type === 'importLayout') {
      const result = await dialog.showOpenDialog(mainWindow!, {
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
        properties: ['openFile'],
      })
      if (!result.canceled && result.filePaths.length > 0) {
        try {
          const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
          const imported = JSON.parse(raw) as Record<string, unknown>
          if (imported.version !== 1 || !Array.isArray(imported.tiles)) return
          writeLayoutToFile(imported)
          emitter?.postMessage({ type: 'layoutLoaded', layout: imported })
        } catch { /* ignore */ }
      }
    } else if (message.type === 'setExternalSessionsEnabled') {
      setSetting('externalSessionsEnabled', message.enabled as boolean)
    } else if (message.type === 'setExternalSessionsScope') {
      setSetting('externalSessionsScope', message.scope as 'currentProject' | 'allProjects')
    } else if (message.type === 'openSessionsFolder') {
      // No-op in standalone (no VS Code to open explorer)
    } else if (message.type === 'saveAgentSeats') {
      // Persisted in memory only for standalone (no workspace state)
    }
  })
}

// ── Window Creation ─────────────────────────────────────────
function createWindow(): void {
  const settings = loadSettings()
  const bounds = settings.windowBounds

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1200,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    title: 'Pixel Agents',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load the webview UI
  // In development: load from webview-ui/dist/
  // In production: load from resources/webview/
  const devPath = path.join(__dirname, '..', '..', 'dist', 'webview', 'index.html')
  const prodPath = path.join(process.resourcesPath || '', 'webview', 'index.html')

  if (fs.existsSync(devPath)) {
    mainWindow.loadFile(devPath)
  } else if (fs.existsSync(prodPath)) {
    mainWindow.loadFile(prodPath)
  } else {
    console.error('[Pixel Agents] Could not find webview index.html')
    console.error('  Tried:', devPath)
    console.error('  Tried:', prodPath)
  }

  // Save window bounds on resize/move
  mainWindow.on('resize', saveWindowBounds)
  mainWindow.on('move', saveWindowBounds)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function saveWindowBounds(): void {
  if (!mainWindow) return
  const bounds = mainWindow.getBounds()
  setSetting('windowBounds', bounds)
}

// ── App Lifecycle ───────────────────────────────────────────
app.whenReady().then(() => {
  loadSettings()
  setupIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  killAllProcesses()
  if (externalScanTimer) clearInterval(externalScanTimer)
  if (layoutWatchTimer) clearInterval(layoutWatchTimer)

  // Clean up all agent watchers
  for (const id of agents.keys()) {
    removeAgent(id)
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})
