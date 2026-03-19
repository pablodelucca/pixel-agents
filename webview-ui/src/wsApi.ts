// WebSocket API — replaces VS Code postMessage bridge
const WS_URL = import.meta.env.DEV
  ? `ws://${window.location.hostname}:5173/ws`
  : `ws://${window.location.host}/ws`;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket(): void {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('Connected to agora server');
    ws?.send(JSON.stringify({ type: 'webviewReady' }));
  };

  ws.onmessage = (event) => {
    // Dispatch as window message to match useExtensionMessages hook
    const data = JSON.parse(event.data as string);
    window.dispatchEvent(new MessageEvent('message', { data }));
  };

  ws.onclose = () => {
    console.log('Disconnected, reconnecting in 2s...');
    reconnectTimer = setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => ws?.close();
}

export function sendMessage(msg: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function cleanup(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
}
