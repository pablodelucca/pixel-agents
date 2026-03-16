import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { OpenClawAgentConfig, OpenClawAgentState,OpenClawConfig } from './openclawTypes.js';

export const OPENCLAW_CONFIG_DIR = path.join(os.homedir(), '.openclaw');
export const OPENCLAW_CONFIG_FILE = path.join(OPENCLAW_CONFIG_DIR, 'openclaw.json');
export const OPENCLAW_AGENTS_DIR = path.join(OPENCLAW_CONFIG_DIR, 'agents');

/**
 * Load OpenClaw configuration from ~/.openclaw/openclaw.json
 */
export function loadOpenClawConfig(): OpenClawConfig | null {
  try {
    if (!fs.existsSync(OPENCLAW_CONFIG_FILE)) {
      console.log('[Pixel Agents] OpenClaw config not found at', OPENCLAW_CONFIG_FILE);
      return null;
    }
    const content = fs.readFileSync(OPENCLAW_CONFIG_FILE, 'utf-8');
    const config = JSON.parse(content) as OpenClawConfig;
    console.log(
      '[Pixel Agents] Loaded OpenClaw config with',
      config.agents?.list?.length ?? 0,
      'agents',
    );
    return config;
  } catch (e) {
    console.error('[Pixel Agents] Failed to load OpenClaw config:', e);
    return null;
  }
}

/**
 * Get list of OpenClaw agents from config
 */
export function getOpenClawAgents(config: OpenClawConfig): OpenClawAgentConfig[] {
  return config.agents?.list ?? [];
}

/**
 * Get sessions directory for an OpenClaw agent
 */
export function getSessionsDir(agentId: string): string {
  return path.join(OPENCLAW_AGENTS_DIR, agentId, 'sessions');
}

/**
 * Find the most recent active session file for an agent
 */
export function findActiveSession(agentId: string): string | null {
  const sessionsDir = getSessionsDir(agentId);
  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  // Read sessions.json to find current session
  const sessionsFile = path.join(sessionsDir, 'sessions.json');
  if (fs.existsSync(sessionsFile)) {
    try {
      const content = fs.readFileSync(sessionsFile, 'utf-8');
      const sessions = JSON.parse(content);
      // Find most recent session by updatedAt
      let latestSession: { sessionFile?: string; updatedAt?: number } | null = null;
      for (const key of Object.keys(sessions)) {
        const session = sessions[key];
        if (session.sessionFile && fs.existsSync(session.sessionFile)) {
          if (
            !latestSession ||
            (session.updatedAt && session.updatedAt > (latestSession.updatedAt ?? 0))
          ) {
            latestSession = session;
          }
        }
      }
      if (latestSession?.sessionFile) {
        return latestSession.sessionFile;
      }
    } catch (e) {
      console.error('[Pixel Agents] Failed to read sessions.json:', e);
    }
  }

  // Fallback: find most recent .jsonl file
  try {
    const files = fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({
        name: f,
        path: path.join(sessionsDir, f),
        mtime: fs.statSync(path.join(sessionsDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      return files[0].path;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Create initial OpenClawAgentState from config
 */
export function createOpenClawAgentState(
  id: number,
  config: OpenClawAgentConfig,
): OpenClawAgentState {
  const name = config.identity?.name || config.name || config.id;
  const emoji = config.identity?.emoji || '🤖';
  const sessionsDir = getSessionsDir(config.id);

  return {
    id,
    openClawId: config.id,
    name,
    emoji,
    sessionsDir,
    activeSessionFile: null,
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    isWaiting: false,
  };
}

/**
 * Get display name for an agent (emoji + name)
 */
export function getAgentDisplayName(agent: OpenClawAgentState): string {
  return `${agent.emoji} ${agent.name}`;
}
