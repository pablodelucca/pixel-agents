import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface PixelAgentsConfig {
  externalAssetDirectories: string[];
  agent_type: 'cloud' | 'copilot';
}

const DEFAULT_CONFIG: PixelAgentsConfig = {
  // By default, no external asset directories are configured
  externalAssetDirectories: [],
  // Default to 'cloud' agent (Claude) if not specified
  agent_type: 'cloud',
};

/**
 * Get the path to the configuration file. This function constructs the file path based on the user's home directory and the predefined layout file directory and configuration file name.
 * @returns The full path to the configuration file.
 */
function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

/**
 * Read the configuration from the config file. If the file does not exist or is invalid, it returns a default configuration. The function ensures that the configuration is always in a valid state by providing defaults for missing or malformed properties.
 * @returns The configuration object containing the external asset directories and the selected agent type.
 */
export function readConfig(): PixelAgentsConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULT_CONFIG };
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PixelAgentsConfig>;
    return {
      externalAssetDirectories: Array.isArray(parsed.externalAssetDirectories)
        ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
        : [],
      agent_type:
        parsed.agent_type === 'cloud' || parsed.agent_type === 'copilot'
          ? parsed.agent_type
          : DEFAULT_CONFIG.agent_type,
    };
  } catch (err) {
    console.error('[Pixel Agents] Failed to read config file:', err);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write the configuration to the config file. This function ensures that the configuration is saved atomically by writing to a temporary file first and then renaming it to the target file.
 * @param config The configuration object to be written to the file.
 */
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
