import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fileWatcher.ts does `import * as vscode from 'vscode'` at module load; the 'vscode'
// package only resolves inside the extension host. Stub the two APIs fileWatcher actually
// touches at runtime (vscode.window.activeTerminal / terminals) so the module loads
// under vitest. Must be declared BEFORE the fileWatcher import.
vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    terminals: [],
  },
}));

import {
  clearDismissedFiles,
  dismissedJsonlFiles,
  pendingClearFiles,
  scanExternalDir,
  scanForNewJsonlFiles,
  seededMtimes,
} from '../../src/fileWatcher.js';
import { DISMISSED_COOLDOWN_MS, EXTERNAL_ACTIVE_THRESHOLD_MS } from '../src/constants.js';
import type { AgentState } from '../src/types.js';

/**
 * Tests for fileWatcher's module-global dismissal/seeding state. These exercise
 * the existing behavior so that when Phase 2 extracts these Maps into a
 * DismissalTracker class, the same assertions continue to hold.
 */

describe('fileWatcher dismissal state', () => {
  let tmpDir: string;
  let projectDir: string;
  let knownJsonlFiles: Set<string>;
  let nextAgentIdRef: { current: number };
  let agents: Map<number, AgentState>;
  let fileWatchers: Map<number, fs.FSWatcher>;
  let pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;

  function writeJsonlFile(name: string, content: string): string {
    const filePath = path.join(projectDir, name);
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  function runExternalScan(): void {
    scanExternalDir(
      projectDir,
      knownJsonlFiles,
      nextAgentIdRef,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      undefined,
      () => {},
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-fw-dismissal-'));
    projectDir = tmpDir;

    // Reset module-global dismissal/seeding state — tests share one module
    // instance, so clean state per test is mandatory.
    dismissedJsonlFiles.clear();
    seededMtimes.clear();
    clearDismissedFiles.clear();
    pendingClearFiles.clear();

    knownJsonlFiles = new Set();
    nextAgentIdRef = { current: 1 };
    agents = new Map();
    fileWatchers = new Map();
    pollingTimers = new Map();
    waitingTimers = new Map();
    permissionTimers = new Map();
  });

  afterEach(() => {
    for (const t of pollingTimers.values()) clearInterval(t);
    for (const t of waitingTimers.values()) clearTimeout(t);
    for (const t of permissionTimers.values()) clearTimeout(t);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ── dismissedJsonlFiles: user-close cooldown ───────────────────────

  describe('dismissedJsonlFiles: user-close cooldown', () => {
    it('blocks external adoption when dismissed < DISMISSED_COOLDOWN_MS ago', () => {
      const file = writeJsonlFile('sess-1.jsonl', '{"type":"assistant"}\n');
      // Dismissed 10 seconds ago — well within the 3-minute cooldown window.
      dismissedJsonlFiles.set(file, Date.now() - 10_000);

      runExternalScan();

      expect(agents.size).toBe(0);
      expect(dismissedJsonlFiles.has(file)).toBe(true); // still blocked; entry preserved
    });

    it('expires dismissal and allows adoption after cooldown', () => {
      const file = writeJsonlFile('sess-1.jsonl', '{"type":"assistant"}\n');
      // Dismissed just over the cooldown boundary.
      dismissedJsonlFiles.set(file, Date.now() - DISMISSED_COOLDOWN_MS - 1_000);

      runExternalScan();

      expect(agents.size).toBe(1);
      expect(dismissedJsonlFiles.has(file)).toBe(false); // expired entry cleaned up on adoption
    });

    it('leaves non-dismissed, recently-modified files adoptable', () => {
      writeJsonlFile('sess-1.jsonl', '{"type":"assistant"}\n');
      // No dismissal entry at all.
      runExternalScan();
      expect(agents.size).toBe(1);
    });
  });

  // ── clearDismissedFiles: permanent block ───────────────────────────

  describe('clearDismissedFiles: permanent block', () => {
    it('never re-adopts a file in the permanent-dismiss set', () => {
      const file = writeJsonlFile('sess-1.jsonl', '{"type":"assistant"}\n');
      clearDismissedFiles.add(file);

      runExternalScan();

      expect(agents.size).toBe(0);
      expect(clearDismissedFiles.has(file)).toBe(true); // never auto-expires
    });

    it('blocks across multiple scanner invocations', () => {
      const file = writeJsonlFile('sess-1.jsonl', '{"type":"assistant"}\n');
      clearDismissedFiles.add(file);

      runExternalScan();
      runExternalScan();
      runExternalScan();

      expect(agents.size).toBe(0);
    });

    it('does NOT prevent adoption of sibling files in the same dir', () => {
      const blocked = writeJsonlFile('old.jsonl', '{"type":"assistant"}\n');
      writeJsonlFile('new.jsonl', '{"type":"assistant"}\n');
      clearDismissedFiles.add(blocked);

      runExternalScan();

      // Only the un-blocked file adopts.
      expect(agents.size).toBe(1);
      const adopted = [...agents.values()][0];
      expect(adopted.jsonlFile).toContain('new.jsonl');
    });
  });

  // ── seededMtimes: mtime-change detection ───────────────────────────

  describe('seededMtimes: mtime-change detection (--resume signal)', () => {
    it('leaves seeded file in known set when mtime unchanged', () => {
      const file = writeJsonlFile('seeded.jsonl', '{"type":"assistant"}\n');
      const stat = fs.statSync(file);
      seededMtimes.set(file, stat.mtimeMs);
      knownJsonlFiles.add(file);

      runExternalScan();

      // Untouched: still in both, no adoption (already known).
      expect(seededMtimes.has(file)).toBe(true);
      expect(knownJsonlFiles.has(file)).toBe(true);
      expect(agents.size).toBe(0);
    });

    it('removes seeded file from tracking when mtime changed', () => {
      const file = writeJsonlFile('seeded.jsonl', '{"type":"assistant"}\n');
      // Seed with an OLD mtime so the file looks "modified since seeding".
      seededMtimes.set(file, fs.statSync(file).mtimeMs - 60_000);
      knownJsonlFiles.add(file);

      runExternalScan();

      // mtime-changed branch removes from BOTH tracking Maps and returns early
      // (no adoption on the same tick — lets agentManager detect /resume first).
      expect(seededMtimes.has(file)).toBe(false);
      expect(knownJsonlFiles.has(file)).toBe(false);
      expect(agents.size).toBe(0);
    });

    it('does NOT adopt as external on the mtime-change tick', () => {
      // Seeding + mtime change should hand off to the extension's /resume
      // detection, not produce a spurious external agent.
      const file = writeJsonlFile('seeded.jsonl', '{"type":"assistant"}\n');
      seededMtimes.set(file, fs.statSync(file).mtimeMs - 30_000);
      knownJsonlFiles.add(file);

      runExternalScan();

      expect(agents.size).toBe(0);
    });
  });

  // ── pendingClearFiles: two-tick delay for /clear content ───────────

  describe('pendingClearFiles: two-tick delay for /clear content', () => {
    const clearJsonl = '{"type":"user","content":"/clear</command-name>"}\n';

    it('first tick: /clear file is registered as pending, not adopted', () => {
      const file = writeJsonlFile('sess-clear.jsonl', clearJsonl);

      runExternalScan();

      expect(agents.size).toBe(0);
      expect(pendingClearFiles.has(file)).toBe(true);
    });

    it('second tick: /clear file is cleared from pending and adopted', () => {
      const file = writeJsonlFile('sess-clear.jsonl', clearJsonl);

      runExternalScan(); // first tick -> pending
      runExternalScan(); // second tick -> adopt

      expect(agents.size).toBe(1);
      expect(pendingClearFiles.has(file)).toBe(false);
    });

    it('non-/clear file adopts on first tick (no pending delay)', () => {
      writeJsonlFile('sess-plain.jsonl', '{"type":"assistant"}\n');

      runExternalScan();

      expect(agents.size).toBe(1);
      expect(pendingClearFiles.size).toBe(0);
    });
  });

  // ── scanForNewJsonlFiles (project-scan helper) ─────────────────────

  describe('scanForNewJsonlFiles: project scanner', () => {
    function runProjectScan(): void {
      scanForNewJsonlFiles(
        projectDir,
        knownJsonlFiles,
        { current: null },
        nextAgentIdRef,
        agents,
        fileWatchers,
        pollingTimers,
        waitingTimers,
        permissionTimers,
        undefined,
        () => {},
      );
    }

    it('skips files already in knownJsonlFiles (seeded at startup)', () => {
      const file = writeJsonlFile('sess-1.jsonl', '{"type":"assistant"}\n');
      knownJsonlFiles.add(file);

      runProjectScan();

      // No adoption — the file is known, not new.
      expect(agents.size).toBe(0);
    });

    it('skips files expired in dismissedJsonlFiles during project scan', () => {
      // Project scan (used by the internal terminal adoption path) also
      // honors dismissal cooldown. Seed the file as dismissed very recently.
      const file = writeJsonlFile('sess-1.jsonl', '{"type":"assistant"}\n');
      dismissedJsonlFiles.set(file, Date.now() - 5_000);

      runProjectScan();

      // No active-terminal agent is present, so adoption shouldn't fire regardless.
      // Primarily: dismissal entry should NOT get erased by this pass.
      expect(dismissedJsonlFiles.has(file)).toBe(true);
    });
  });

  // ── Constants sanity check ────────────────────────────────────────

  it('constants are within sensible bounds', () => {
    // Guards against accidental changes that would make these tests lie.
    expect(DISMISSED_COOLDOWN_MS).toBeGreaterThan(60_000);
    expect(EXTERNAL_ACTIVE_THRESHOLD_MS).toBeGreaterThan(30_000);
  });
});
