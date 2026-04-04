import * as fs from 'fs';
import * as path from 'path';

import {
  createParserState,
  findSessionFileById,
  type SessionProviderAdapter,
} from '../../../packages/core/src/index.js';
import {
  JSONL_DISCOVERY_INTERVAL_MS,
  JSONL_POLL_INTERVAL_MS,
  TOOL_DONE_DELAY_MS,
} from './constants.js';
import type { HostToRendererMessage } from './types.js';

interface SessionWatcherOptions {
  agentId: number;
  sessionId: string;
  expectedJsonlFile: string;
  cwd: string;
  startedAtMs: number;
  isSessionFileClaimed?: (filePath: string) => boolean;
  providerAdapter: SessionProviderAdapter;
  onMessage: (message: HostToRendererMessage) => void;
}

const CODEX_DISCOVERY_LOOKBACK_MS = 2 * 60 * 1000;
const CODEX_DISCOVERY_MAX_FILES = 120;

interface SessionFileCandidate {
  filePath: string;
  mtimeMs: number;
}

function collectRecentJsonlFiles(rootDir: string, minMtimeMs: number): SessionFileCandidate[] {
  const candidates: SessionFileCandidate[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) break;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs >= minMtimeMs) {
          candidates.push({
            filePath: fullPath,
            mtimeMs: stat.mtimeMs,
          });
        }
      } catch {
        // Ignore files that disappear mid-scan.
      }
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates.slice(0, CODEX_DISCOVERY_MAX_FILES);
}

function readFirstLine(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    if (bytesRead <= 0) return null;
    const firstChunk = buffer.toString('utf-8', 0, bytesRead);
    const newlineIndex = firstChunk.indexOf('\n');
    const line = newlineIndex >= 0 ? firstChunk.slice(0, newlineIndex) : firstChunk;
    return line.trim() || null;
  } catch {
    return null;
  }
}

function extractSessionMetaCwd(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as {
      type?: unknown;
      payload?: { cwd?: unknown };
    };
    if (parsed.type !== 'session_meta') return null;
    const cwd = parsed.payload?.cwd;
    return typeof cwd === 'string' ? cwd : null;
  } catch {
    return null;
  }
}

export class SessionWatcher {
  private readonly options: SessionWatcherOptions;
  private readonly parserState = createParserState();
  private readonly normalizedCwd: string;
  private readonly codexMetaCache = new Map<string, string | null>();
  private readonly delayedTimers = new Set<ReturnType<typeof setTimeout>>();
  private jsonlFile: string;
  private fileOffset = 0;
  private lineBuffer = '';
  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionWatcherOptions) {
    this.options = options;
    this.normalizedCwd = path.resolve(options.cwd);
    this.jsonlFile = options.expectedJsonlFile;
  }

  start(): void {
    this.startDiscovery();
  }

  getSessionFile(): string {
    return this.jsonlFile;
  }

  dispose(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const timer of this.delayedTimers) {
      clearTimeout(timer);
    }
    this.delayedTimers.clear();
  }

  private startDiscovery(): void {
    this.discoveryTimer = setInterval(() => {
      const discoveredById = findSessionFileById(
        this.options.providerAdapter.projectsRoot,
        this.options.sessionId,
      );

      let discovered = discoveredById;
      if (!discovered && this.options.providerAdapter.id === 'codex') {
        discovered = this.findCodexSessionFile();
      }

      if (
        discovered &&
        discovered !== this.jsonlFile &&
        !this.options.isSessionFileClaimed?.(discovered)
      ) {
        this.jsonlFile = discovered;
      }

      if (!fs.existsSync(this.jsonlFile)) return;

      if (this.discoveryTimer) {
        clearInterval(this.discoveryTimer);
        this.discoveryTimer = null;
      }
      this.startPolling();
      this.readNewLines();
    }, JSONL_DISCOVERY_INTERVAL_MS);
  }

  private findCodexSessionFile(): string | null {
    const minMtime = this.options.startedAtMs - CODEX_DISCOVERY_LOOKBACK_MS;
    const candidates = collectRecentJsonlFiles(this.options.providerAdapter.projectsRoot, minMtime);

    for (const candidate of candidates) {
      if (this.options.isSessionFileClaimed?.(candidate.filePath)) {
        continue;
      }

      let metaCwd = this.codexMetaCache.get(candidate.filePath);
      if (metaCwd === undefined) {
        const firstLine = readFirstLine(candidate.filePath);
        metaCwd = firstLine ? extractSessionMetaCwd(firstLine) : null;
        this.codexMetaCache.set(candidate.filePath, metaCwd);
      }
      if (!metaCwd) continue;
      if (path.resolve(metaCwd) === this.normalizedCwd) {
        return candidate.filePath;
      }
    }

    return null;
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.readNewLines(), JSONL_POLL_INTERVAL_MS);
  }

  private readNewLines(): void {
    try {
      if (!fs.existsSync(this.jsonlFile)) return;
      const stat = fs.statSync(this.jsonlFile);
      if (stat.size <= this.fileOffset) return;

      const maxRead = 65536;
      const bytesToRead = Math.min(stat.size - this.fileOffset, maxRead);
      const buffer = Buffer.alloc(bytesToRead);
      const fd = fs.openSync(this.jsonlFile, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, this.fileOffset);
      fs.closeSync(fd);
      this.fileOffset += bytesToRead;

      const text = this.lineBuffer + buffer.toString('utf-8');
      const lines = text.split('\n');
      this.lineBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const events = this.options.providerAdapter.parseRecord(
          this.options.agentId,
          line,
          this.parserState,
        );
        for (const event of events) {
          const message = event as HostToRendererMessage;
          if (event.type === 'agentToolDone' || event.type === 'subagentToolDone') {
            const timer = setTimeout(() => {
              this.delayedTimers.delete(timer);
              this.options.onMessage(message);
            }, TOOL_DONE_DELAY_MS);
            this.delayedTimers.add(timer);
            continue;
          }
          this.options.onMessage(message);
        }
      }
    } catch {
      // Ignore malformed/partial reads while transcript is still being written.
    }
  }
}

export function deriveFolderName(projectPath: string): string {
  return path.basename(projectPath);
}
