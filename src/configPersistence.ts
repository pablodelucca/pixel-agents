import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CONFIG_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';
import { logger } from './logger.js';
import { DEFAULT_CONFIG, parseConfig, type PixelAgentsConfig } from './schemas/index.js';
import { isSymlink } from './symlinkCheck.js';

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

export function readConfig(): PixelAgentsConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) return { ...DEFAULT_CONFIG };
    // SEC-014: Reject symlinks to prevent symlink-based path traversal attacks.
    if (isSymlink(filePath)) {
      logger.warn(`SEC-014: Refusing to read symlinked config file: ${filePath}`);
      return { ...DEFAULT_CONFIG };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseConfig(raw);
  } catch (err) {
    logger.error('Failed to read config file:', err);
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: PixelAgentsConfig): void {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    logger.error('Failed to write config file:', err);
  }
}
