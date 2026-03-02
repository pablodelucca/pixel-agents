/**
 * VS Code API / WebSocket bridge
 *
 * Runtime detection: if acquireVsCodeApi exists (VS Code webview), use it.
 * Otherwise (standalone browser / CLI mode), connect via WebSocket.
 */

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

interface VscodeApi {
	postMessage(msg: unknown): void
}

/** True when running in standalone CLI mode (browser), false in VS Code */
export let isCliMode = false

function createWebSocketBridge(): VscodeApi {
	isCliMode = true
	let ws: WebSocket | null = null
	let connected = false
	const queue: unknown[] = []

	function connect() {
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
		ws = new WebSocket(`${protocol}//${location.host}/ws`)

		ws.onopen = () => {
			connected = true
			// Flush queued messages
			for (const msg of queue) {
				ws!.send(JSON.stringify(msg))
			}
			queue.length = 0
		}

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data)
				// Dispatch as a MessageEvent so existing useExtensionMessages hooks work
				window.dispatchEvent(new MessageEvent('message', { data }))
			} catch { /* ignore malformed */ }
		}

		ws.onclose = () => {
			connected = false
			ws = null
			// Auto-reconnect after 2s
			setTimeout(connect, 2000)
		}

		ws.onerror = () => {
			// onclose will fire after this
		}
	}

	connect()

	return {
		postMessage(msg: unknown) {
			if (connected && ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(msg))
			} else {
				queue.push(msg)
			}
		},
	}
}

function createApi(): VscodeApi {
	try {
		// VS Code webview — acquireVsCodeApi is injected by the host
		return acquireVsCodeApi()
	} catch {
		// Standalone browser — use WebSocket
		return createWebSocketBridge()
	}
}

export const vscode = createApi()
