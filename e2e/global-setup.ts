import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import fs from 'fs';
import path from 'path';

export const VSCODE_CACHE_DIR = path.join(__dirname, '../.vscode-test');
export const VSCODE_PATH_FILE = path.join(VSCODE_CACHE_DIR, 'vscode-executable.txt');

export default async function globalSetup(): Promise<void> {
  console.log('[e2e] Ensuring VS Code is downloaded...');
  const vscodePath = await downloadAndUnzipVSCode({
    version: 'stable',
    cachePath: VSCODE_CACHE_DIR,
  });
  console.log(`[e2e] VS Code executable: ${vscodePath}`);

  fs.mkdirSync(VSCODE_CACHE_DIR, { recursive: true });
  fs.writeFileSync(VSCODE_PATH_FILE, vscodePath, 'utf8');
}
