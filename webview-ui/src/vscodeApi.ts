// Standalone mode — routes postMessage calls through WebSocket
import { sendMessage } from './wsApi.js';

export const vscode = { postMessage: sendMessage };
