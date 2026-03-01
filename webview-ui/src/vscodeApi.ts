declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

function createDevBridge(): { postMessage(msg: unknown): void } {
    let ws: WebSocket | null = null;
    let pendingMessages: unknown[] = [];

    function connect(): void {
        ws = new WebSocket('ws://localhost:3100');
        ws.onopen = () => {
            console.log('[DevBridge] Connected to dev server');
            window.postMessage({ type: 'setDevMode', isDevMode: true }, '*');
            // Send any pending messages
            for (const msg of pendingMessages) {
                ws!.send(JSON.stringify(msg));
            }
            pendingMessages = [];
        };
        ws.onmessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data as string);
                window.postMessage(data, '*');
            } catch { /* ignore */ }
        };
        ws.onclose = () => {
            console.log('[DevBridge] Disconnected, retrying in 2s...');
            ws = null;
            setTimeout(connect, 2000);
        };
        ws.onerror = () => {
            ws?.close();
        };
    }

    connect();

    return {
        postMessage: (msg: unknown) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(msg));
            } else {
                pendingMessages.push(msg);
            }
        },
    };
}

export const vscode =
    typeof acquireVsCodeApi === 'function'
        ? acquireVsCodeApi()
        : createDevBridge();
