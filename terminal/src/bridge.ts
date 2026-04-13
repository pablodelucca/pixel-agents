import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * HTTP + WebSocket server that:
 * - Serves webview-ui/dist as a static web app
 * - Injects a WebSocket client script into index.html so the browser can receive live events
 * - Broadcasts messages to all connected WebSocket clients
 */
export class TerminalBridge {
  private server: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private port = 0;
  private readonly webviewDir: string;

  constructor(webviewDir?: string) {
    // In development (tsx), __dirname is terminal/src/ so ../../ reaches the repo root.
    // In production (compiled), callers should pass webviewDir explicitly.
    this.webviewDir = webviewDir ?? path.resolve(__dirname, '../../dist/webview');
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
    this.wss = new WebSocketServer({ noServer: true });

    this.server.on('upgrade', (req, socket, head) => {
      if (req.url === '/events') {
        this.wss.handleUpgrade(
          req,
          socket as Parameters<typeof this.wss.handleUpgrade>[1],
          head,
          (ws) => {
            this.wss.emit('connection', ws);
            this.clients.add(ws);
            ws.on('close', () => {
              this.clients.delete(ws);
            });
          },
        );
      }
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to get bridge server address'));
        }
      });
      this.server.on('error', reject);
    });
  }

  stop(): void {
    this.wss.close();
    this.server.close();
  }

  /** Send a webview protocol message to all connected browser clients. */
  broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === 1 /* WebSocket.OPEN */) {
        client.send(data);
      }
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const urlPath = req.url?.split('?')[0] ?? '/';
    const safePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    let filePath = path.join(this.webviewDir, safePath);

    // Path traversal guard
    if (!filePath.startsWith(this.webviewDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // SPA fallback: unknown routes serve index.html
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(this.webviewDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    try {
      let content: Buffer = fs.readFileSync(filePath);

      // Inject WebSocket client before </body> so the browser connects to the terminal runner
      if (ext === '.html') {
        const injected = this.buildInjectedScript();
        content = Buffer.from(content.toString('utf-8').replace('</body>', `${injected}</body>`));
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end('Internal server error');
    }
  }

  /**
   * Builds the inline script injected into index.html.
   *
   * Sets window.__PIXEL_AGENTS_TERMINAL__ = true so future code can detect terminal mode,
   * then opens a WebSocket to /events and forwards each received message to window as a
   * MessageEvent — exactly what useExtensionMessages already listens for.
   */
  private buildInjectedScript(): string {
    return `<script>
(function () {
  window.__PIXEL_AGENTS_TERMINAL__ = true;
  var ws = new WebSocket('ws://127.0.0.1:${this.port}/events');
  ws.onopen = function () {
    console.log('[pixel-agents-terminal] Connected to runner');
  };
  ws.onmessage = function (e) {
    try {
      var data = JSON.parse(e.data);
      window.dispatchEvent(new MessageEvent('message', { data: data }));
    } catch (err) {
      console.error('[pixel-agents-terminal] Failed to parse message', err);
    }
  };
  ws.onerror = function (e) {
    console.error('[pixel-agents-terminal] WebSocket error', e);
  };
  ws.onclose = function () {
    console.warn('[pixel-agents-terminal] Disconnected from runner');
  };
})();
</script>`;
  }
}
