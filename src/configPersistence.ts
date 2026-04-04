import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AGENT_PROVIDER_ID,
  type AgentProviderId,
  type StoredAgentProviderConfig,
} from './agentProvider.js';
import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface PixelAgentsConfig {
  externalAssetDirectories: string[];
  provider: StoredAgentProviderConfig;
}

const DEFAULT_CONFIG: PixelAgentsConfig = {
  externalAssetDirectories: [],
  provider: { id: AGENT_PROVIDER_ID.CLAUDE },
};

function createDefaultConfig(): PixelAgentsConfig {
  return {
    externalAssetDirectories: [],
    provider: { ...DEFAULT_CONFIG.provider },
  };
}

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

function isProviderId(value: unknown): value is AgentProviderId {
  return (
    value === AGENT_PROVIDER_ID.CLAUDE ||
    value === AGENT_PROVIDER_ID.CODEX ||
    value === AGENT_PROVIDER_ID.GEMINI ||
    value === AGENT_PROVIDER_ID.CUSTOM
  );
}

function parseProviderConfig(raw: unknown): StoredAgentProviderConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CONFIG.provider };
  }

  const candidate = raw as Partial<StoredAgentProviderConfig>;
  const id = isProviderId(candidate.id) ? candidate.id : AGENT_PROVIDER_ID.CLAUDE;

  if (id !== AGENT_PROVIDER_ID.CUSTOM) {
    return { id };
  }

  return {
    id,
    customCommand:
      typeof candidate.customCommand === 'string' ? candidate.customCommand : undefined,
    customDisplayName:
      typeof candidate.customDisplayName === 'string' ? candidate.customDisplayName : undefined,
    customProjectsRoot:
      typeof candidate.customProjectsRoot === 'string' ? candidate.customProjectsRoot : undefined,
  };
}

export function readConfig(): PixelAgentsConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) return createDefaultConfig();
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PixelAgentsConfig>;
    return {
      externalAssetDirectories: Array.isArray(parsed.externalAssetDirectories)
        ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
        : [],
      provider: parseProviderConfig(parsed.provider),
    };
  } catch (err) {
    console.error('[Pixel Agents] Failed to read config file:', err);
    return createDefaultConfig();
  }
}

export function writeConfig(config: PixelAgentsConfig): void {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write config file:', err);
  }
}
