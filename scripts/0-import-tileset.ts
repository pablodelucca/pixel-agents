#!/usr/bin/env node
/**
 * Pixel Agents Tileset Import Skill - Complete CLI wrapper for 7-stage asset extraction pipeline
 *
 * Usage:
 *   npx ts-node scripts/import-tileset-cli.ts
 *
 * This script guides you through the complete process of extracting furniture assets
 * from a tileset PNG file and integrating them into the Pixel Agents extension.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as readline from 'readline'
import { execSync } from 'child_process'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve)
  })
}

interface StageStatus {
  name: string
  description: string
  completed: boolean
  script?: string
}

const stages: StageStatus[] = [
  {
    name: 'Stage 1: Asset Detection',
    description: 'Automatically detect individual assets from tileset using flood-fill',
    completed: false,
    script: 'scripts/1-detect-assets.ts',
  },
  {
    name: 'Stage 2: Asset Editor',
    description: 'Interactively edit asset positions, sizes, and erase unwanted pixels',
    completed: false,
  },
  {
    name: 'Stage 3: Vision Inspection',
    description: 'Use Claude vision to auto-generate metadata for each asset',
    completed: false,
    script: 'scripts/3-vision-inspect.ts',
  },
  {
    name: 'Stage 4: Metadata Review',
    description: 'Review and edit all asset metadata (name, category, flags, etc)',
    completed: false,
  },
  {
    name: 'Stage 5: Export Assets',
    description: 'Export approved assets as PNG files + generate catalog.json',
    completed: false,
    script: 'scripts/5-export-assets.ts',
  },
  {
    name: 'Stage 6: Extension Integration',
    description: 'Assets bundled with extension and loaded at runtime',
    completed: false,
  },
  {
    name: 'Stage 7: You are here!',
    description: 'Using this CLI to repeat the process for new tilesets',
    completed: true,
  },
]

function displayBanner() {
  console.clear()
  console.log('\n')
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║                  🎨 ARCADIA TILESET IMPORT SKILL 🎨             ║')
  console.log('║            Complete Asset Extraction Pipeline (7 Stages)         ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')
  console.log()
}

function displayStages() {
  console.log('\n📋 Pipeline Stages:\n')
  stages.forEach((stage, idx) => {
    const icon = stage.completed ? '✅' : '⬜'
    const status = stage.completed ? ' COMPLETE' : ''
    console.log(`${icon} ${stage.name}${status}`)
    console.log(`   ${stage.description}`)
    console.log()
  })
}

async function displayMenu() {
  console.log('\n🎯 Main Menu:')
  console.log('  1. Start new tileset import')
  console.log('  2. View pipeline stages')
  console.log('  3. Run specific stage')
  console.log('  4. Exit')
  console.log()

  const choice = await question('Select option (1-4): ')
  return choice.trim()
}

async function getFileInput(prompt: string, filter?: string): Promise<string> {
  let valid = false
  let file = ''

  while (!valid) {
    file = await question(prompt)
    file = file.trim().replace(/^['"]|['"]$/g, '') // Remove quotes

    if (!fs.existsSync(file)) {
      console.log(`❌ File not found: ${file}`)
      continue
    }

    if (filter && !file.endsWith(filter)) {
      console.log(`❌ File must be a ${filter} file`)
      continue
    }

    valid = true
  }

  return file
}

async function runStage1(tilesetFile: string) {
  console.log('\n📍 Stage 1: Asset Detection')
  console.log('─'.repeat(60))
  console.log('Flood-fill algorithm will automatically detect all individual assets')
  console.log(`Input: ${tilesetFile}`)
  console.log('Output: tileset-detection-output.json')
  console.log()

  // Copy tileset to root if needed
  const tilesetDest = path.join(process.cwd(), 'assets', 'office_tileset_16x16.png')
  if (!fs.existsSync(tilesetDest)) {
    console.log(`📦 Copying tileset to ${tilesetDest}...`)
    const destDir = path.dirname(tilesetDest)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    fs.copyFileSync(tilesetFile, tilesetDest)
  }

  const confirm = await question('Run Stage 1? (y/n): ')
  if (confirm.toLowerCase() === 'y') {
    try {
      console.log('\n🔄 Running detection...')
      execSync('npx ts-node scripts/detect-tileset-assets.ts', { stdio: 'inherit' })
      console.log('\n✅ Stage 1 complete!')
      return true
    } catch (err) {
      console.log('\n❌ Stage 1 failed')
      return false
    }
  }
  return false
}

async function runStage2() {
  console.log('\n📍 Stage 2: Asset Editor')
  console.log('─'.repeat(60))
  console.log('Interactive editor for refining asset positions and erase unwanted pixels')
  console.log('Input: tileset-detection-output.json')
  console.log('Output: asset-editor-output.json')
  console.log()
  console.log('📝 Open scripts/asset-editor.html in a web browser to edit assets')
  console.log('   1. Adjust bounding boxes')
  console.log('   2. Split stuck/overlapped assets')
  console.log('   3. Erase unwanted pixels')
  console.log('   4. Export when done')
  console.log()

  const confirm = await question('Open editor? (y/n): ')
  if (confirm.toLowerCase() === 'y') {
    try {
      const editorPath = path.join(process.cwd(), 'scripts', '2-asset-editor.html')
      console.log(`\n📂 Opening: ${editorPath}`)
      if (process.platform === 'win32') {
        execSync(`start "" "${editorPath}"`)
      } else if (process.platform === 'darwin') {
        execSync(`open "${editorPath}"`)
      } else {
        execSync(`xdg-open "${editorPath}"`)
      }

      console.log('\n⏳ Editor opened in browser. When finished:')
      const done = await question('Press Enter when done editing...')
      console.log('✅ Stage 2 complete!')
      return true
    } catch (err) {
      console.log('❌ Could not open editor')
      return false
    }
  }
  return false
}

async function runStage3() {
  console.log('\n📍 Stage 3: Vision Inspection')
  console.log('─'.repeat(60))
  console.log('Claude vision API analyzes each asset and generates metadata')
  console.log('Input: asset-editor-output.json + office_tileset_16x16.png')
  console.log('Output: tileset-metadata-draft.json')
  console.log()
  console.log('⚠️  Requires ANTHROPIC_API_KEY in .env file')
  console.log()

  const confirm = await question('Run Stage 3? (y/n): ')
  if (confirm.toLowerCase() === 'y') {
    try {
      console.log('\n🔄 Running vision inspection...')
      execSync('npx ts-node scripts/inspect-assets.ts', { stdio: 'inherit' })
      console.log('\n✅ Stage 3 complete!')
      return true
    } catch (err) {
      console.log('\n❌ Stage 3 failed')
      return false
    }
  }
  return false
}

async function runStage4() {
  console.log('\n📍 Stage 4: Metadata Review')
  console.log('─'.repeat(60))
  console.log('Interactive review and editing of all asset metadata')
  console.log('Input: tileset-metadata-draft.json')
  console.log('Output: tileset-metadata-final.json')
  console.log()
  console.log('📝 Open scripts/review-assets.html in a web browser to review')
  console.log('   1. View asset previews (4x zoom with grid)')
  console.log('   2. Edit metadata: name, label, category')
  console.log('   3. Set footprint dimensions (in tiles)')
  console.log('   4. Mark special flags: isDesk, canPlaceOnWalls, canPlaceOnSurfaces')
  console.log('   5. Mark assets to discard')
  console.log('   6. Auto-saves to localStorage every 2 seconds')
  console.log()

  const confirm = await question('Open review editor? (y/n): ')
  if (confirm.toLowerCase() === 'y') {
    try {
      const editorPath = path.join(process.cwd(), 'scripts', '4-review-metadata.html')
      console.log(`\n📂 Opening: ${editorPath}`)
      if (process.platform === 'win32') {
        execSync(`start "" "${editorPath}"`)
      } else if (process.platform === 'darwin') {
        execSync(`open "${editorPath}"`)
      } else {
        execSync(`xdg-open "${editorPath}"`)
      }

      console.log('\n⏳ Editor opened in browser. When finished:')
      const done = await question('Press Enter when done reviewing...')
      console.log('✅ Stage 4 complete!')
      return true
    } catch (err) {
      console.log('❌ Could not open editor')
      return false
    }
  }
  return false
}

async function runStage5() {
  console.log('\n📍 Stage 5: Export Assets')
  console.log('─'.repeat(60))
  console.log('Export approved assets as PNG files + generate furniture-catalog.json')
  console.log('Input: tileset-metadata-final.json + office_tileset_16x16.png')
  console.log('Output: assets/furniture/{category}/{id}.png + furniture-catalog.json')
  console.log()

  const confirm = await question('Run Stage 5? (y/n): ')
  if (confirm.toLowerCase() === 'y') {
    try {
      console.log('\n🔄 Exporting assets...')
      execSync('npx ts-node scripts/export-tileset-assets.ts', { stdio: 'inherit' })
      console.log('\n✅ Stage 5 complete!')
      return true
    } catch (err) {
      console.log('\n❌ Stage 5 failed')
      return false
    }
  }
  return false
}

async function runStage6() {
  console.log('\n📍 Stage 6: Extension Integration')
  console.log('─'.repeat(60))
  console.log('Assets are automatically bundled with the extension and loaded at runtime')
  console.log()
  console.log('✅ Automatic! Just rebuild the extension:')
  console.log('   npm run build')
  console.log()
  console.log('📦 The extension now:')
  console.log('   • Bundles assets/furniture/* in dist/')
  console.log('   • Loads assets from dist/assets/ at runtime')
  console.log('   • Works in any directory (no workspace dependency)')
  console.log('   • Shows ONLY your custom assets (hides hardcoded furniture)')
  console.log()

  const confirm = await question('Rebuild extension now? (y/n): ')
  if (confirm.toLowerCase() === 'y') {
    try {
      console.log('\n🔄 Building extension...')
      execSync('npm run build', { stdio: 'inherit' })
      console.log('\n✅ Stage 6 complete! Extension ready to use.')
      return true
    } catch (err) {
      console.log('\n❌ Build failed')
      return false
    }
  }
  return false
}

async function runPipeline() {
  displayBanner()
  console.log('🎬 Starting new tileset import workflow...\n')

  const tilesetFile = await getFileInput(
    '📁 Enter path to tileset PNG file: ',
    '.png',
  )

  console.log('\n' + '═'.repeat(60))
  console.log('Running 6-stage asset extraction pipeline...')
  console.log('═'.repeat(60))

  const results: { [key: number]: boolean } = {}

  // Stage 1
  results[1] = await runStage1(tilesetFile)
  if (!results[1]) return

  // Stage 2
  results[2] = await runStage2()
  if (!results[2]) return

  // Stage 3
  results[3] = await runStage3()
  if (!results[3]) return

  // Stage 4
  results[4] = await runStage4()
  if (!results[4]) return

  // Stage 5
  results[5] = await runStage5()
  if (!results[5]) return

  // Stage 6
  results[6] = await runStage6()

  // Final summary
  console.log('\n' + '═'.repeat(60))
  console.log('🎉 PIPELINE COMPLETE!')
  console.log('═'.repeat(60))
  console.log()
  console.log('✨ Your tileset assets are now integrated into Pixel Agents!')
  console.log()
  console.log('📝 Summary:')
  console.log('   Stage 1: ✅ Detection complete')
  console.log('   Stage 2: ✅ Assets edited')
  console.log('   Stage 3: ✅ Metadata generated')
  console.log('   Stage 4: ✅ Metadata reviewed')
  console.log('   Stage 5: ✅ Assets exported to assets/furniture/')
  console.log('   Stage 6: ✅ Extension bundled')
  console.log()
  console.log('🚀 Next steps:')
  console.log('   1. Press F5 in VS Code to test the extension')
  console.log('   2. Your custom assets will be available in the editor')
  console.log('   3. Click "Edit" → "Place" to see all your furniture')
  console.log()
  console.log('To run another tileset, execute:')
  console.log('   npx ts-node scripts/import-tileset-cli.ts')
  console.log()
}

async function main() {
  displayBanner()

  let running = true
  while (running) {
    const choice = await displayMenu()

    switch (choice) {
      case '1':
        await runPipeline()
        break
      case '2':
        displayStages()
        break
      case '3':
        const stage = await question(
          'Enter stage number (1-6): ',
        )
        console.log(`Stage ${stage} selected (not yet implemented)`)
        break
      case '4':
        console.log('\n👋 Goodbye!\n')
        running = false
        break
      default:
        console.log('❌ Invalid option')
    }

    if (running) {
      const again = await question('\nContinue? (y/n): ')
      if (again.toLowerCase() !== 'y') {
        running = false
      }
    }
  }

  rl.close()
}

main()
