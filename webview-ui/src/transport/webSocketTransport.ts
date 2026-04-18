import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { MessageTransport } from './types.js';

/**
 * WebSocket transport for standalone browser mode.
 * Connects to the Pixel Agents server via WebSocket for bidirectional messaging.
 *
 * Not yet functional -- requires the standalone server to expose a WebSocket endpoint.
 */
export class WebSocketTransport implements MessageTransport {
  private ws: WebSocket | null = null;
  private handlers: Array<(msg: ServerMessage) => void> = [];
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      for (const handler of this.handlers) handler(msg);
    };
  }

  send(message: ClientMessage): void {
    this.ws?.send(JSON.stringify(message));
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  dispose(): void {
    this.ws?.close();
    this.ws = null;
    this.handlers = [];
  }
}
