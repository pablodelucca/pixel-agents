import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CODEX_HOOK_EVENTS, CODEX_HOOK_SCRIPT_NAME, HOOK_SCRIPTS_DIR } from '../../constants.js';

/** Marker string used to identify Pixel Agents hook entries in Claude's settings. */
const HOOK_SCRIPT_MARKER = CODEX_HOOK_SCRIPT_NAME;

/** A single hook entry in Codex Code's ~/.codex/settings.json hooks config. */
interface CodexHookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    timeout?: number;
  }>;
}

/** Partial shape of ~/.codex/settings.json (only the hooks field is relevant). */
interface CodexSettings {
  hooks?: Record<string, CodexHookEntry[]>;
  [key: string]: unknown;
}

/** Returns the absolute path to ~/.codex/settings.json. */
function getCodexSettingsPath(): string {
  return path.join(os.homedir(), '.codex', 'settings.json');
}

/** Returns the destination path for the hook script (~/.pixel-agents/hooks/codex-hook.js). */
function getHookScriptPath(): string {
  return path.join(os.homedir(), HOOK_SCRIPTS_DIR, CODEX_HOOK_SCRIPT_NAME);
}

/** Read and parse ~/.codex/settings.json. Returns empty object if missing or malformed. */
function readCodexSettings(): CodexSettings {
  const settingsPath = getCodexSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as CodexSettings;
    }
  } catch (e) {
    console.error(`[Pixel Agents] Failed to read Codex settings: ${e}`);
  }
  return {};
}

/** Write settings back to ~/.codex/settings.json via atomic tmp + rename. */
function writeCodexSettings(settings: CodexSettings): void {
  const settingsPath = getCodexSettingsPath();
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
    console.error(`[Pixel Agents] Failed to write Codex settings: ${e}`);
  }
}

/** Legacy script name (before rename to codex-hook.js). */
const LEGACY_HOOK_MARKER = 'pixel-agents-hook.js';

/** Check if a hook entry belongs to Pixel Agents (current or legacy script name). */
function isOurHookEntry(entry: CodexHookEntry): boolean {
  return entry.hooks.some(
    (h) => h.command.includes(HOOK_SCRIPT_MARKER) || h.command.includes(LEGACY_HOOK_MARKER),
  );
}

/** Build the shell command that Codex Code will execute for each hook event. */
function makeHookCommand(): string {
  const scriptPath = getHookScriptPath();
  return `node "${scriptPath}"`;
}

/** Create a hook entry object for Codex's settings.json. Matcher is empty (catch-all). */
function makeHookEntry(): CodexHookEntry {
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

/** Check if Pixel Agents hooks are already installed in ~/.codex/settings.json. */
export function areHooksInstalled(): boolean {
  const settings = readCodexSettings();
  if (!settings.hooks) return false;
  const events = CODEX_HOOK_EVENTS;
  return events.every((event) => {
    const entries = settings.hooks?.[event];
    return Array.isArray(entries) && entries.some(isOurHookEntry);
  });
}

/**
 * Install Pixel Agents hook entries into ~/.codex/settings.json for
 * Notification, Stop, and PermissionRequest events. Idempotent: removes
 * any existing Pixel Agents entries before adding fresh ones.
 */
export function installHooks(): void {
  const settings = readCodexSettings();
  if (!settings.hooks) {
    settings.hooks = {};
  }

  const events = CODEX_HOOK_EVENTS;
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
    writeCodexSettings(settings);
    console.log('[Pixel Agents] Hooks installed in ~/.codex/settings.json');
  }
}

/** Remove all Pixel Agents hook entries from ~/.codex/settings.json. Cleans up empty objects. */
export function uninstallHooks(): void {
  const settings = readCodexSettings();
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
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (changed) {
    writeCodexSettings(settings);
    console.log('[Pixel Agents] Hooks removed from ~/.codex/settings.json');
  }
}

/** Copy the shipped hook script from the extension to ~/.pixel-agents/hooks/ */
export function copyHookScript(extensionPath: string): void {
  const src = path.join(extensionPath, 'dist', 'hooks', CODEX_HOOK_SCRIPT_NAME);
  const dst = getHookScriptPath();
  const dstDir = path.dirname(dst);

  try {
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(src)) {
      console.warn(`[Pixel Agents] Hook script not found at ${src}`);
      return;
    }
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o700);
    console.log(`[Pixel Agents] Hook script installed at ${dst}`);
  } catch (e) {
    console.error(`[Pixel Agents] Failed to copy hook script: ${e}`);
  }
}
