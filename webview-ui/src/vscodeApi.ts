declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

interface VsCodeLike {
  postMessage(msg: unknown): void;
}

function createStandaloneApi(): VsCodeLike {
  let ws: WebSocket | null = null;
  let pendingMessages: unknown[] = [];
  let connected = false;

  function connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      connected = true;
      console.log('[Standalone] WebSocket connected');
      // Flush pending messages
      for (const msg of pendingMessages) {
        ws!.send(JSON.stringify(msg));
      }
      pendingMessages = [];
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Dispatch as a MessageEvent on window, matching VS Code webview protocol
        window.dispatchEvent(new MessageEvent('message', { data }));
      } catch {
        /* ignore bad messages */
      }
    };

    ws.onclose = () => {
      connected = false;
      console.log('[Standalone] WebSocket disconnected, reconnecting...');
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  connect();

  return {
    postMessage(msg: unknown): void {
      if (connected && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        pendingMessages.push(msg);
      }
    },
  };
}

function createApi(): VsCodeLike {
  if (typeof acquireVsCodeApi === 'function') {
    try {
      return acquireVsCodeApi();
    } catch {
      // Not in VS Code webview
    }
  }
  return createStandaloneApi();
}

export const vscode: VsCodeLike = createApi();
