/**
 * scanner.js — Standalone JSONL scanner (ESM, pure JavaScript)
 *
 * Scans ~/.claude/projects/ for active Claude Code JSONL transcripts,
 * watches them for changes, and emits structured messages via callback.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Constants ────────────────────────────────────────────────
const SCAN_INTERVAL_MS = 5_000;
const FILE_WATCHER_POLL_INTERVAL_MS = 1_000;
const MAX_AGE_MS = 15 * 60 * 1_000; // 15 minutes
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// ── Helpers ──────────────────────────────────────────────────

/**
 * Extract a friendly name from a project dir name.
 * e.g. "-Users-foo-Documents-Projetos-dasho-web" → "dasho-web"
 */
function extractFolderName(dirName) {
  const segments = dirName.split('-').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : dirName;
}

/**
 * Format a tool status string from the tool name and input.
 */
function formatToolStatus(toolName, input) {
  const base = (p) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Reading ${base(input.file_path)}`;
    case 'Edit':
      return `Editing ${base(input.file_path)}`;
    case 'Write':
      return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command) || '';
      return `Running: ${cmd.length > 30 ? cmd.slice(0, 30) + '\u2026' : cmd}`;
    }
    case 'Glob':
      return 'Searching files';
    case 'Grep':
      return 'Searching code';
    case 'WebFetch':
      return 'Fetching web content';
    case 'WebSearch':
      return 'Searching the web';
    case 'Task':
    case 'Agent': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > 40 ? desc.slice(0, 40) + '\u2026' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion':
      return 'Waiting for your answer';
    case 'NotebookEdit':
      return 'Editing notebook';
    default:
      return `Using ${toolName}`;
  }
}

// ── Scanner Class ────────────────────────────────────────────

export class Scanner {
  /** @param {(message: object) => void} callback */
  constructor(callback) {
    this._callback = callback;
    this._agents = new Map();          // id → agent state
    this._knownJsonlFiles = new Set(); // full paths of discovered jsonl files
    this._nextAgentId = 1;
    this._scanTimer = null;
    this._fileWatchers = new Map();    // agentId → fs.FSWatcher
    this._pollingTimers = new Map();   // agentId → setInterval handle
  }

  /** Start scanning for JSONL files. */
  start() {
    // Run an initial scan immediately
    this._scanAllProjects();
    // Then scan periodically
    this._scanTimer = setInterval(() => this._scanAllProjects(), SCAN_INTERVAL_MS);
  }

  /** Stop all watchers and timers. */
  stop() {
    if (this._scanTimer) {
      clearInterval(this._scanTimer);
      this._scanTimer = null;
    }

    for (const [agentId, watcher] of this._fileWatchers) {
      try { watcher.close(); } catch { /* ignore */ }
    }
    this._fileWatchers.clear();

    for (const [agentId, timer] of this._pollingTimers) {
      clearInterval(timer);
    }
    this._pollingTimers.clear();

    // Unwatch all files
    for (const agent of this._agents.values()) {
      try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }
    }

    this._agents.clear();
    this._knownJsonlFiles.clear();
    this._nextAgentId = 1;
  }

  /** @returns {Map} Map of active agents */
  getAgents() {
    return this._agents;
  }

  // ── Private: Scanning ────────────────────────────────────

  _scanAllProjects() {
    let projectDirs;
    try {
      projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    } catch {
      return; // ~/.claude/projects/ may not exist
    }

    for (const entry of projectDirs) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(CLAUDE_PROJECTS_DIR, entry.name);
      this._scanProjectDir(projectDir, entry.name);
    }
  }

  _scanProjectDir(projectDir, projectDirName) {
    const now = Date.now();

    // Collect JSONL files from root of project dir
    const jsonlFiles = this._collectJsonlFiles(projectDir, now);

    // Also check UUID subdirs (but NOT subagents/)
    try {
      const entries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'subagents') continue;
        const subDir = path.join(projectDir, entry.name);
        const subFiles = this._collectJsonlFiles(subDir, now);
        jsonlFiles.push(...subFiles);
      }
    } catch { /* ignore */ }

    // Register any new JSONL files
    for (const filePath of jsonlFiles) {
      if (this._knownJsonlFiles.has(filePath)) continue;
      this._knownJsonlFiles.add(filePath);
      this._registerAgent(filePath, projectDir, projectDirName);
    }
  }

  /**
   * Collect .jsonl files from a directory, filtering out files older than MAX_AGE_MS.
   */
  _collectJsonlFiles(dir, now) {
    const results = [];
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs <= MAX_AGE_MS) {
            results.push(fullPath);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return results;
  }

  // ── Private: Agent Registration ──────────────────────────

  _registerAgent(jsonlFile, projectDir, projectDirName) {
    const id = this._nextAgentId++;
    const folderName = extractFolderName(projectDirName);

    // Get file size to skip to end (only track new activity)
    let fileOffset = 0;
    try {
      const stat = fs.statSync(jsonlFile);
      fileOffset = stat.size;
    } catch { /* ignore */ }

    const agent = {
      id,
      projectDir,
      jsonlFile,
      fileOffset,
      lineBuffer: '',
      activeToolIds: new Set(),
      folderName,
    };

    this._agents.set(id, agent);

    // Emit agentCreated
    this._callback({ type: 'agentCreated', id, folderName });

    // Start hybrid file watching
    this._startFileWatching(id, jsonlFile);
  }

  // ── Private: File Watching (hybrid approach) ─────────────

  _startFileWatching(agentId, filePath) {
    // Primary: fs.watch (event-based, may miss events on macOS)
    try {
      const watcher = fs.watch(filePath, () => {
        this._readNewLines(agentId);
      });
      this._fileWatchers.set(agentId, watcher);
    } catch {
      // fs.watch may fail on some systems
    }

    // Secondary: fs.watchFile (stat-based polling, reliable on macOS)
    try {
      fs.watchFile(filePath, { interval: FILE_WATCHER_POLL_INTERVAL_MS }, () => {
        this._readNewLines(agentId);
      });
    } catch {
      // ignore
    }

    // Tertiary: manual poll as last resort
    const interval = setInterval(() => {
      if (!this._agents.has(agentId)) {
        clearInterval(interval);
        try { fs.unwatchFile(filePath); } catch { /* ignore */ }
        return;
      }
      this._readNewLines(agentId);
    }, FILE_WATCHER_POLL_INTERVAL_MS);
    this._pollingTimers.set(agentId, interval);
  }

  _readNewLines(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return;

    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (stat.size <= agent.fileOffset) return;

      const buf = Buffer.alloc(stat.size - agent.fileOffset);
      const fd = fs.openSync(agent.jsonlFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
      fs.closeSync(fd);
      agent.fileOffset = stat.size;

      const text = agent.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      agent.lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this._processLine(agentId, line);
      }
    } catch {
      // Read errors can happen if file is being written to
    }
  }

  // ── Private: JSONL Parsing ───────────────────────────────

  _processLine(agentId, line) {
    const agent = this._agents.get(agentId);
    if (!agent) return;

    try {
      const record = JSON.parse(line);

      // Assistant message with tool_use blocks
      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        for (const block of record.message.content) {
          if (block.type === 'tool_use' && block.id) {
            const toolName = block.name || '';
            const status = formatToolStatus(toolName, block.input || {});
            agent.activeToolIds.add(block.id);
            this._callback({
              type: 'agentToolStart',
              id: agentId,
              toolId: block.id,
              status,
            });
          }
        }
      }

      // User message with tool_result blocks
      else if (record.type === 'user' && Array.isArray(record.message?.content)) {
        for (const block of record.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            agent.activeToolIds.delete(block.tool_use_id);
            this._callback({
              type: 'agentToolDone',
              id: agentId,
              toolId: block.tool_use_id,
            });
          }
        }
      }

      // System turn_duration → turn ended, clear all tools
      else if (record.type === 'system' && record.subtype === 'turn_duration') {
        agent.activeToolIds.clear();
        this._callback({
          type: 'agentToolsClear',
          id: agentId,
        });
      }
    } catch {
      // Ignore malformed JSON lines
    }
  }
}
