import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AGENT_PROVIDER_ID,
  type AgentProviderId,
  type StoredAgentProviderConfig,
} from '../../../packages/core/src/index.js';
import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR, LAYOUT_FILE_NAME } from './constants.js';
import type { DesktopConfig } from './types.js';

const DEFAULT_CONFIG: DesktopConfig = {
  externalAssetDirectories: [],
  provider: { id: AGENT_PROVIDER_ID.CLAUDE },
  soundEnabled: true,
  watchAllSessions: false,
  alwaysShowLabels: false,
  rememberProviderChoice: true,
};

function getConfigPath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

function getLayoutPath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, LAYOUT_FILE_NAME);
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureParentDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function isProviderId(value: unknown): value is AgentProviderId {
  return (
    value === AGENT_PROVIDER_ID.CLAUDE ||
    value === AGENT_PROVIDER_ID.CODEX ||
    value === AGENT_PROVIDER_ID.GEMINI ||
    value === AGENT_PROVIDER_ID.CUSTOM
  );
}

function parseProvider(value: unknown): StoredAgentProviderConfig {
  const object =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const id = isProviderId(object.id) ? object.id : AGENT_PROVIDER_ID.CLAUDE;

  if (id !== AGENT_PROVIDER_ID.CUSTOM) {
    return { id };
  }

  return {
    id,
    customCommand: typeof object.customCommand === 'string' ? object.customCommand : undefined,
    customDisplayName:
      typeof object.customDisplayName === 'string' ? object.customDisplayName : undefined,
    customProjectsRoot:
      typeof object.customProjectsRoot === 'string' ? object.customProjectsRoot : undefined,
  };
}

export function readDesktopConfig(): DesktopConfig {
  const filePath = getConfigPath();
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULT_CONFIG };
    const json = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    return {
      externalAssetDirectories: Array.isArray(json.externalAssetDirectories)
        ? json.externalAssetDirectories.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
      provider: parseProvider(json.provider),
      soundEnabled:
        typeof json.soundEnabled === 'boolean' ? json.soundEnabled : DEFAULT_CONFIG.soundEnabled,
      watchAllSessions:
        typeof json.watchAllSessions === 'boolean'
          ? json.watchAllSessions
          : DEFAULT_CONFIG.watchAllSessions,
      alwaysShowLabels:
        typeof json.alwaysShowLabels === 'boolean'
          ? json.alwaysShowLabels
          : DEFAULT_CONFIG.alwaysShowLabels,
      rememberProviderChoice:
        typeof json.rememberProviderChoice === 'boolean'
          ? json.rememberProviderChoice
          : DEFAULT_CONFIG.rememberProviderChoice,
      lastProjectDirectory:
        typeof json.lastProjectDirectory === 'string' ? json.lastProjectDirectory : undefined,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeDesktopConfig(config: DesktopConfig): void {
  writeJsonAtomic(getConfigPath(), config);
}

export function readLayoutFromFile(): Record<string, unknown> | null {
  const filePath = getLayoutPath();
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function writeLayoutToFile(layout: Record<string, unknown>): void {
  writeJsonAtomic(getLayoutPath(), layout);
}

export function loadDefaultLayout(assetsDir: string): Record<string, unknown> | null {
  try {
    let bestRevision = 0;
    let bestFile: string | null = null;

    if (fs.existsSync(assetsDir)) {
      for (const entry of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(entry);
        if (!match) continue;
        const revision = parseInt(match[1], 10);
        if (revision > bestRevision) {
          bestRevision = revision;
          bestFile = path.join(assetsDir, entry);
        }
      }
    }

    if (!bestFile) {
      const fallback = path.join(assetsDir, 'default-layout.json');
      if (fs.existsSync(fallback)) {
        bestFile = fallback;
      }
    }

    if (!bestFile) return null;
    return JSON.parse(fs.readFileSync(bestFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function loadLayoutWithFallback(assetsDir: string): {
  layout: Record<string, unknown> | null;
  wasReset: boolean;
} {
  const currentLayout = readLayoutFromFile();
  if (currentLayout) {
    return { layout: currentLayout, wasReset: false };
  }

  const defaultLayout = loadDefaultLayout(assetsDir);
  if (!defaultLayout) {
    return { layout: null, wasReset: false };
  }

  writeLayoutToFile(defaultLayout);
  return { layout: defaultLayout, wasReset: false };
}
