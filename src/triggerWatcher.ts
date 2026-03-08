import * as fs from 'fs';
import * as path from 'path';

import type { TriggerEvent } from './types.js';

/** How long to consider a trigger "recent" (ms) */
export const TRIGGER_RECENT_MS = 10_000;

/** Which agent each trigger targets */
const TRIGGER_TARGET_MAP: Record<string, number> = {
  leads_scored: 2, // → Outreach Engine
  send_due: 2, // → Outreach Engine
  deal_created: 3, // → Deal Closer
  lead_responded: 3, // → Deal Closer
  deal_under_contract: 3, // → Deal Closer
  scrape_complete: 1, // → Lead Scout
};

/** All trigger names we care about */
const WATCHED_TRIGGERS = Object.keys(TRIGGER_TARGET_MAP);

export interface TriggerWatcherState {
  watcher: fs.FSWatcher | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  recentTriggers: TriggerEvent[];
  seenFiles: Set<string>; // track files we've already processed
}

export function getTargetAgentId(triggerName: string): number | null {
  return TRIGGER_TARGET_MAP[triggerName] ?? null;
}

function readTriggerFile(triggerDir: string, name: string): Record<string, unknown> | null {
  const filePath = path.join(triggerDir, name);
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return {};
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function scanTriggers(triggerDir: string, state: TriggerWatcherState): void {
  if (!fs.existsSync(triggerDir)) return;

  try {
    const files = fs.readdirSync(triggerDir);
    for (const file of files) {
      // Skip hidden files and the watermark file
      if (file.startsWith('.') || file === 'imessage_watermark') continue;

      const triggerName = file;
      if (!WATCHED_TRIGGERS.includes(triggerName)) continue;

      // Check if we've already seen this file (by name + mtime)
      const filePath = path.join(triggerDir, file);
      let mtime: number;
      try {
        mtime = fs.statSync(filePath).mtimeMs;
      } catch {
        continue; // file may have been deleted
      }
      const fileKey = `${triggerName}:${mtime}`;
      if (state.seenFiles.has(fileKey)) continue;
      state.seenFiles.add(fileKey);

      const payload = readTriggerFile(triggerDir, triggerName) ?? {};
      const event: TriggerEvent = {
        name: triggerName,
        payload,
        timestamp: Date.now(),
      };
      state.recentTriggers.push(event);
    }
  } catch (err) {
    console.error('[TriggerWatcher] scan error:', err);
  }

  // Prune old triggers
  const cutoff = Date.now() - TRIGGER_RECENT_MS * 3;
  state.recentTriggers = state.recentTriggers.filter((t) => t.timestamp > cutoff);
}

export function startTriggerWatcher(
  wholesaleDir: string,
  onTrigger?: (event: TriggerEvent) => void,
): TriggerWatcherState {
  const triggerDir = path.join(wholesaleDir, '.triggers');
  const state: TriggerWatcherState = {
    watcher: null,
    pollTimer: null,
    recentTriggers: [],
    seenFiles: new Set(),
  };

  const handleScan = () => {
    const prevCount = state.recentTriggers.length;
    scanTriggers(triggerDir, state);
    // Notify about new triggers
    if (onTrigger) {
      for (let i = prevCount; i < state.recentTriggers.length; i++) {
        onTrigger(state.recentTriggers[i]);
      }
    }
  };

  // Initial scan
  handleScan();

  // Watch for changes
  try {
    if (fs.existsSync(triggerDir)) {
      state.watcher = fs.watch(triggerDir, { persistent: false }, () => {
        handleScan();
      });
      state.watcher.on('error', () => {
        /* ignore */
      });
    }
  } catch {
    /* ignore fs.watch failures */
  }

  // Polling backup (every 2s)
  state.pollTimer = setInterval(handleScan, 2000);

  return state;
}

export function getRecentTriggers(state: TriggerWatcherState): TriggerEvent[] {
  const cutoff = Date.now() - TRIGGER_RECENT_MS;
  return state.recentTriggers.filter((t) => t.timestamp > cutoff);
}

export function disposeTriggerWatcher(state: TriggerWatcherState): void {
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}
