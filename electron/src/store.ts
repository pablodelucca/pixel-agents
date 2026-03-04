import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const STORE_DIR = path.join(os.homedir(), '.pixel-agents')
const STORE_FILE = path.join(STORE_DIR, 'electron-settings.json')

interface StoreData {
  soundEnabled: boolean
  showLabelsAlways: boolean
  externalSessionsEnabled: boolean
  externalSessionsScope: 'currentProject' | 'allProjects'
  windowBounds?: { x: number; y: number; width: number; height: number }
}

const defaults: StoreData = {
  soundEnabled: true,
  showLabelsAlways: false,
  externalSessionsEnabled: true,
  externalSessionsScope: 'allProjects',
}

let data: StoreData = { ...defaults }

export function loadSettings(): StoreData {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<StoreData>
      data = { ...defaults, ...parsed }
    }
  } catch {
    data = { ...defaults }
  }
  return data
}

export function saveSettings(): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true })
    }
    const tmpFile = STORE_FILE + '.tmp'
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpFile, STORE_FILE)
  } catch (err) {
    console.error('[Pixel Agents] Failed to save settings:', err)
  }
}

export function getSetting<K extends keyof StoreData>(key: K): StoreData[K] {
  return data[key]
}

export function setSetting<K extends keyof StoreData>(key: K, value: StoreData[K]): void {
  data[key] = value
  saveSettings()
}
