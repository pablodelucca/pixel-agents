/**
 * Simple JSON key-value store persisted at ~/.pixel-agents/electron-store.json.
 * Replaces vscode.ExtensionContext.workspaceState / globalState for Electron.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STORE_DIR = '.pixel-agents';
const STORE_FILE = 'electron-store.json';

class Store {
  private data: Record<string, unknown> = {};
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(os.homedir(), STORE_DIR, STORE_FILE);
    this.load();
  }

  get<T>(key: string, defaultValue: T): T {
    const value = this.data[key];
    if (value === undefined) return defaultValue;
    return value as T;
  }

  update(key: string, value: unknown): void {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    this.save();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw) as Record<string, unknown>;
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[Store] Failed to save:', err);
    }
  }
}

export const store = new Store();
