import * as fs from 'fs';
import * as path from 'path';

import type { LogEvent } from './types.js';
import { WHOLESALE_AGENTS } from './types.js';

/** How long to consider a log event "recent" for activity detection (ms) */
export const LOG_ACTIVE_MS = 30_000;

/** Pattern: [AgentName HH:MM:SS] message */
const LOG_LINE_PATTERN = /^\s*\[(\w+(?:\s+\w+)*)\s+(\d{2}:\d{2}:\d{2})\]\s*(.+)$/;

interface TailedFile {
  path: string;
  offset: number;
  lineBuffer: string;
  watcher: fs.FSWatcher | null;
}

export interface LogTailerState {
  files: Map<string, TailedFile>;
  pollTimer: ReturnType<typeof setInterval> | null;
  recentEvents: LogEvent[];
}

function readNewLines(file: TailedFile): string[] {
  try {
    const stat = fs.statSync(file.path);
    if (stat.size < file.offset) {
      // File was truncated/rotated — start from beginning
      file.offset = 0;
      file.lineBuffer = '';
    }
    if (stat.size <= file.offset) return [];

    const fd = fs.openSync(file.path, 'r');
    const buffer = Buffer.alloc(stat.size - file.offset);
    fs.readSync(fd, buffer, 0, buffer.length, file.offset);
    fs.closeSync(fd);

    file.offset = stat.size;

    const text = file.lineBuffer + buffer.toString('utf-8');
    const parts = text.split('\n');
    // Last part may be incomplete
    file.lineBuffer = parts.pop() ?? '';
    return parts.filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}

function parseLine(line: string): LogEvent | null {
  const match = line.match(LOG_LINE_PATTERN);
  if (!match) return null;
  return {
    agent: match[1],
    timestamp: match[2],
    message: match[3],
    rawLine: line,
    parsedAt: Date.now(),
  };
}

function setupFileWatcher(file: TailedFile, onNewLines: () => void): void {
  try {
    file.watcher = fs.watch(file.path, { persistent: false }, () => {
      onNewLines();
    });
    file.watcher.on('error', () => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}

export function startLogTailer(wholesaleDir: string): LogTailerState {
  const logsDir = path.join(wholesaleDir, 'logs');
  const state: LogTailerState = {
    files: new Map(),
    pollTimer: null,
    recentEvents: [],
  };

  // Set up tailing for each agent's log file
  for (const agent of Object.values(WHOLESALE_AGENTS)) {
    const logPath = path.join(logsDir, agent.logFile);
    const file: TailedFile = {
      path: logPath,
      offset: 0,
      lineBuffer: '',
      watcher: null,
    };

    // Start at end of file (only tail new content)
    try {
      if (fs.existsSync(logPath)) {
        file.offset = fs.statSync(logPath).size;
      }
    } catch {
      /* ignore */
    }

    state.files.set(agent.logFile, file);

    const processNewLines = () => {
      const lines = readNewLines(file);
      for (const line of lines) {
        const event = parseLine(line);
        if (event) {
          state.recentEvents.push(event);
        }
      }
      // Prune old events
      const cutoff = Date.now() - LOG_ACTIVE_MS * 3;
      state.recentEvents = state.recentEvents.filter((e) => e.parsedAt > cutoff);
    };

    // Set up fs.watch
    if (fs.existsSync(logPath)) {
      setupFileWatcher(file, processNewLines);
    }
  }

  // Polling backup (every 2s)
  state.pollTimer = setInterval(() => {
    for (const file of state.files.values()) {
      // If file didn't exist at start but exists now, set up watcher
      if (!file.watcher && fs.existsSync(file.path)) {
        setupFileWatcher(file, () => {
          const lines = readNewLines(file);
          for (const line of lines) {
            const event = parseLine(line);
            if (event) state.recentEvents.push(event);
          }
        });
      }
      const lines = readNewLines(file);
      for (const line of lines) {
        const event = parseLine(line);
        if (event) state.recentEvents.push(event);
      }
    }
    // Prune
    const cutoff = Date.now() - LOG_ACTIVE_MS * 3;
    state.recentEvents = state.recentEvents.filter((e) => e.parsedAt > cutoff);
  }, 2000);

  return state;
}

/** Get recent log events for a specific agent name */
export function getRecentEventsForAgent(state: LogTailerState, agentName: string): LogEvent[] {
  const cutoff = Date.now() - LOG_ACTIVE_MS;
  return state.recentEvents.filter(
    (e) => e.parsedAt > cutoff && e.agent.toLowerCase().includes(agentName.toLowerCase()),
  );
}

/** Check if an agent has had activity within the last N ms */
export function hasRecentActivity(
  state: LogTailerState,
  agentName: string,
  withinMs: number = LOG_ACTIVE_MS,
): boolean {
  const cutoff = Date.now() - withinMs;
  return state.recentEvents.some(
    (e) => e.parsedAt > cutoff && e.agent.toLowerCase().includes(agentName.toLowerCase()),
  );
}

/** Get the latest log message for an agent */
export function getLatestMessage(state: LogTailerState, agentName: string): string | null {
  const events = state.recentEvents.filter((e) =>
    e.agent.toLowerCase().includes(agentName.toLowerCase()),
  );
  if (events.length === 0) return null;
  return events[events.length - 1].message;
}

export function disposeLogTailer(state: LogTailerState): void {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  for (const file of state.files.values()) {
    if (file.watcher) {
      file.watcher.close();
      file.watcher = null;
    }
  }
}
