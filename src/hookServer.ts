import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { HOOK_PORT_DIR, HOOK_PORT_FILE_PREFIX, HOOK_SERVER_PATH } from './constants.js';

export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  notification_type?: string;
  message?: string;
  title?: string;
  last_assistant_message?: string;
  transcript_path?: string;
  agent_id?: string;
  agent_type?: string;
}

type HookEventCallback = (event: HookEvent) => void;

export class HookServer {
  private server: http.Server | null = null;
  private port = 0;
  private portFilePath = '';
  private callback: HookEventCallback | null = null;

  onEvent(callback: HookEventCallback): void {
    this.callback = callback;
  }

  async start(): Promise<number> {
    this.cleanupStalePortFiles();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === HOOK_SERVER_PATH) {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            try {
              const event = JSON.parse(body) as HookEvent;
              if (event.session_id && event.hook_event_name) {
                this.callback?.(event);
              }
              res.writeHead(200);
              res.end('ok');
            } catch {
              res.writeHead(400);
              res.end('invalid json');
            }
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.on('error', reject);

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          this.writePortFile();
          console.log(`[Pixel Agents] Hook server listening on 127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.deletePortFile();
  }

  getPort(): number {
    return this.port;
  }

  private getPortDir(): string {
    return path.join(os.homedir(), HOOK_PORT_DIR);
  }

  private writePortFile(): void {
    const dir = this.getPortDir();
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.portFilePath = path.join(dir, `${HOOK_PORT_FILE_PREFIX}${process.pid}`);
      fs.writeFileSync(this.portFilePath, String(this.port), 'utf-8');
    } catch (e) {
      console.error(`[Pixel Agents] Failed to write port file: ${e}`);
    }
  }

  private deletePortFile(): void {
    if (this.portFilePath) {
      try {
        fs.unlinkSync(this.portFilePath);
      } catch {
        // File may already be gone
      }
      this.portFilePath = '';
    }
  }

  private cleanupStalePortFiles(): void {
    const dir = this.getPortDir();
    try {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter((f) => f.startsWith(HOOK_PORT_FILE_PREFIX));
      for (const file of files) {
        const pidStr = file.slice(HOOK_PORT_FILE_PREFIX.length);
        const pid = parseInt(pidStr, 10);
        if (isNaN(pid)) continue;
        if (!isProcessRunning(pid)) {
          try {
            fs.unlinkSync(path.join(dir, file));
            console.log(`[Pixel Agents] Cleaned up stale port file for PID ${pid}`);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
