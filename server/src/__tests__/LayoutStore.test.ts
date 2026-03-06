import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LayoutStore } from '../LayoutStore.js'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('LayoutStore', () => {
  let tmpDir: string
  let store: LayoutStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-test-'))
    store = new LayoutStore(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('starts with empty JSON', () => {
    expect(store.getJson()).toBe('{}')
    expect(store.getEtag()).toBe('')
  })

  it('loads layout from disk', () => {
    const layoutFile = path.join(tmpDir, 'layout.json')
    fs.writeFileSync(layoutFile, '{"version":1}')
    store.load()
    expect(store.getJson()).toBe('{"version":1}')
    expect(store.getEtag()).not.toBe('')
  })

  it('saves layout to disk atomically', () => {
    store.update('{"tiles":[]}')
    const layoutFile = path.join(tmpDir, 'layout.json')
    expect(fs.existsSync(layoutFile)).toBe(true)
    expect(fs.readFileSync(layoutFile, 'utf-8')).toBe('{"tiles":[]}')
  })

  it('computes new etag on update', () => {
    store.update('{"a":1}')
    const etag1 = store.getEtag()
    store.update('{"a":2}')
    const etag2 = store.getEtag()
    expect(etag1).not.toBe(etag2)
  })

  it('creates data dir if it does not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'dir')
    const s2 = new LayoutStore(nested)
    s2.update('{"ok":true}')
    expect(fs.existsSync(path.join(nested, 'layout.json'))).toBe(true)
  })

  it('rejects invalid JSON', () => {
    expect(() => store.update('not json')).toThrow()
  })
})
