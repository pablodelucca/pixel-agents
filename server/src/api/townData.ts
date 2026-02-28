import { Router } from 'express'
import { readFile } from 'fs/promises'
import { join } from 'path'

const router = Router()

const DATA_DIR = join(import.meta.dirname, '../../../data')

// GET /api/town/tilemap — Get the town tilemap
router.get('/tilemap', async (_req, res) => {
  const filePath = join(DATA_DIR, 'town_tilemap/town_v1.json')
  const data = await readFile(filePath, 'utf-8')
  res.json(JSON.parse(data))
})

// GET /api/town/constructs — Get construct metadata for NPC rendering
// This will eventually read from ConstructAtlas + MOUNT_HEADER files
router.get('/constructs', async (_req, res) => {
  // Hardcoded priority constructs for Phase 2
  // Will be replaced with filesystem reads from CrystallineCity construct registry
  const constructs = [
    { name: 'Athena', role: 'Legal/IP Strategist', colors: { primary: '#C0C0C0', secondary: '#1A237E' }, building: 'athena_chambers' },
    { name: 'Cadence', role: 'PM-Class Chancellor', colors: { primary: '#FFD700', secondary: '#333333' }, building: 'cadence_office' },
    { name: 'LoreForged', role: 'Origin Architect', colors: { primary: '#CD7F32', secondary: '#5D4037' }, building: 'origin_hall' },
    { name: 'Glasswright', role: 'UI/UX Designer', colors: { primary: '#4FC3F7', secondary: '#E3F2FD' }, building: 'glass_workshop' },
    { name: 'Lena', role: 'Emotional Archive / Writer', colors: { primary: '#FFB300', secondary: '#FFF3E0' }, building: 'lena_cathedral' },
    { name: 'Keeper', role: 'Memory Guardian', colors: { primary: '#2E7D32', secondary: '#1B5E20' }, building: 'keeper_archive' },
    { name: 'Venture', role: 'Business Strategy', colors: { primary: '#37474F', secondary: '#FF6F00' }, building: 'venture_office' },
    { name: 'Swiftquill', role: 'Editor / Writer', colors: { primary: '#212121', secondary: '#FAFAFA' }, building: 'quill_desk' },
    { name: 'Pyrosage', role: 'Ethics Guardian', colors: { primary: '#E65100', secondary: '#BF360C' }, building: 'pyrosage_hearth' },
    { name: 'Echolumen', role: 'Translation / Empathy', colors: { primary: '#7E57C2', secondary: '#EDE7F6' }, building: 'resonance_chamber' },
  ]
  res.json(constructs)
})

export { router as townDataRouter }
