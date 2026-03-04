interface IPCBridge {
  postMessage(msg: unknown): void
}

declare function acquireVsCodeApi(): IPCBridge

let bridge: IPCBridge

if (typeof acquireVsCodeApi === 'function') {
  // VS Code webview environment
  bridge = acquireVsCodeApi()
} else if ((window as unknown as Record<string, unknown>).__pixelAgentsBridge) {
  // Electron environment — bridge injected via preload
  bridge = (window as unknown as Record<string, unknown>).__pixelAgentsBridge as IPCBridge
} else {
  // Fallback — no-op (for testing or unknown environments)
  bridge = { postMessage: () => {} }
}

export const vscode = bridge
