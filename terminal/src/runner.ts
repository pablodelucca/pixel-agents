import { PixelAgentsServer } from '../../server/src/server.js';

import { TerminalBridge } from './bridge.js';
import { EventTranslator } from './eventTranslator.js';

/**
 * Orchestrates the three components of the terminal runner:
 *
 * 1. PixelAgentsServer  — existing HTTP server that receives Claude Code hook events
 *                         and writes ~/.pixel-agents/server.json for hook script discovery.
 * 2. TerminalBridge     — HTTP static server (webview-ui/dist) + WebSocket server.
 *                         Injects a client script into index.html that forwards
 *                         WebSocket messages to window so useExtensionMessages receives them.
 * 3. EventTranslator    — translates raw hook events into webview protocol messages
 *                         (agentCreated, agentToolStart, agentStatus, …) and broadcasts
 *                         them to all connected browser clients.
 */
export class TerminalRunner {
  private readonly hookServer = new PixelAgentsServer();
  private readonly bridge: TerminalBridge;
  private readonly translator: EventTranslator;

  constructor(webviewDir?: string) {
    this.bridge = new TerminalBridge(webviewDir);
    this.translator = new EventTranslator(this.bridge);
  }

  async start(): Promise<void> {
    const [hookConfig, uiPort] = await Promise.all([this.hookServer.start(), this.bridge.start()]);

    this.hookServer.onHookEvent((providerId, event) => {
      this.translator.handleHookEvent(providerId, event);
    });

    console.log('');
    console.log('[pixel-agents-terminal] Runner started');
    console.log(
      `[pixel-agents-terminal] Hook server : http://127.0.0.1:${hookConfig.port.toString()}`,
    );
    console.log(`[pixel-agents-terminal] Open in browser: http://127.0.0.1:${uiPort.toString()}`);
    console.log('[pixel-agents-terminal] Press Ctrl+C to stop');
    console.log('');
  }

  stop(): void {
    this.hookServer.stop();
    this.bridge.stop();
    console.log('[pixel-agents-terminal] Stopped');
  }
}
