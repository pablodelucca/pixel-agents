import { isBrowserRuntime } from '../runtime.js';
import { PostMessageTransport } from './postMessageTransport.js';
import type { MessageTransport } from './types.js';

function createTransport(): MessageTransport {
  if (!isBrowserRuntime) {
    return new PostMessageTransport();
  }
  // Future: return new WebSocketTransport(wsUrl);
  // For now, fall back to console logging (dev/browser mode)
  return {
    send: (msg) => console.log('[Transport] send:', msg),
    onMessage: () => () => {},
    dispose: () => {},
  };
}

/** Singleton transport instance. Import this everywhere instead of vscodeApi. */
export const transport: MessageTransport = createTransport();
export type { MessageTransport } from './types.js';
