import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  HOOK_PORT_DIR,
  HOOK_PORT_FILE_PREFIX,
  HOOK_SCRIPT_DIR,
  HOOK_SCRIPT_NAME,
  HOOK_SERVER_PATH,
} from './constants.js';

const HOOK_SCRIPT_MARKER = HOOK_SCRIPT_NAME;

interface ClaudeHookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    timeout?: number;
  }>;
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookEntry[]>;
  [key: string]: unknown;
}

function getClaudeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function getHookScriptPath(): string {
  return path.join(os.homedir(), HOOK_SCRIPT_DIR, HOOK_SCRIPT_NAME);
}

function readClaudeSettings(): ClaudeSettings {
  const settingsPath = getClaudeSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings;
    }
  } catch (e) {
    console.error(`[Pixel Agents] Failed to read Claude settings: ${e}`);
  }
  return {};
}

function writeClaudeSettings(settings: ClaudeSettings): void {
  const settingsPath = getClaudeSettingsPath();
  const dir = path.dirname(settingsPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Atomic write via tmp file + rename
    const tmpPath = settingsPath + '.pixel-agents-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmpPath, settingsPath);
  } catch (e) {
    console.error(`[Pixel Agents] Failed to write Claude settings: ${e}`);
  }
}

function isOurHookEntry(entry: ClaudeHookEntry): boolean {
  return entry.hooks.some((h) => h.command.includes(HOOK_SCRIPT_MARKER));
}

function makeHookCommand(): string {
  const scriptPath = getHookScriptPath();
  return `node "${scriptPath}"`;
}

function makeHookEntry(): ClaudeHookEntry {
  return {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: makeHookCommand(),
        timeout: 5,
      },
    ],
  };
}

export function areHooksInstalled(): boolean {
  const settings = readClaudeSettings();
  if (!settings.hooks) return false;
  const events = ['Notification', 'Stop', 'PermissionRequest'];
  return events.every((event) => {
    const entries = settings.hooks?.[event];
    return Array.isArray(entries) && entries.some(isOurHookEntry);
  });
}

export function installHooks(): void {
  const settings = readClaudeSettings();
  if (!settings.hooks) {
    settings.hooks = {};
  }

  const events = ['Notification', 'Stop', 'PermissionRequest'];
  let changed = false;

  for (const event of events) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
    }
    const entries = settings.hooks[event];
    // Remove any existing Pixel Agents entries (in case script path changed)
    const filtered = entries.filter((e) => !isOurHookEntry(e));
    filtered.push(makeHookEntry());
    if (JSON.stringify(filtered) !== JSON.stringify(entries)) {
      settings.hooks[event] = filtered;
      changed = true;
    }
  }

  if (changed) {
    writeClaudeSettings(settings);
    console.log('[Pixel Agents] Hooks installed in ~/.claude/settings.json');
  }

  installHookScript();
}

export function uninstallHooks(): void {
  const settings = readClaudeSettings();
  if (!settings.hooks) return;

  let changed = false;
  for (const event of Object.keys(settings.hooks)) {
    const entries = settings.hooks[event];
    if (!Array.isArray(entries)) continue;
    const filtered = entries.filter((e) => !isOurHookEntry(e));
    if (filtered.length !== entries.length) {
      settings.hooks[event] = filtered;
      changed = true;
    }
    // Clean up empty arrays
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (changed) {
    writeClaudeSettings(settings);
    console.log('[Pixel Agents] Hooks removed from ~/.claude/settings.json');
  }
}

function installHookScript(): void {
  const scriptPath = getHookScriptPath();
  const scriptDir = path.dirname(scriptPath);

  try {
    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }

    const portDir = path.join(os.homedir(), HOOK_PORT_DIR);
    const portPrefix = HOOK_PORT_FILE_PREFIX;

    // Node.js hook script — reads stdin JSON, POSTs to all active Pixel Agents instances
    const script = `#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT_DIR = ${JSON.stringify(portDir)};
const PORT_PREFIX = ${JSON.stringify(portPrefix)};
const SERVER_PATH = ${JSON.stringify(HOOK_SERVER_PATH)};

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Read all port files
  let files;
  try {
    files = fs.readdirSync(PORT_DIR).filter(f => f.startsWith(PORT_PREFIX));
  } catch {
    process.exit(0);
  }

  const posts = files.map(file => {
    let port;
    try {
      port = parseInt(fs.readFileSync(path.join(PORT_DIR, file), 'utf-8').trim(), 10);
    } catch {
      return Promise.resolve();
    }
    if (!port || isNaN(port)) return Promise.resolve();

    const body = JSON.stringify(data);
    return new Promise(resolve => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: SERVER_PATH,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 2000,
      }, () => resolve());
      req.on('error', () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end(body);
    });
  });

  await Promise.all(posts);
}

main().catch(() => {}).finally(() => process.exit(0));
`;

    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    console.log(`[Pixel Agents] Hook script installed at ${scriptPath}`);
  } catch (e) {
    console.error(`[Pixel Agents] Failed to install hook script: ${e}`);
  }
}
