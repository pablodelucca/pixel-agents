declare global {
  interface Window {
    electronAPI?: {
      postMessage(message: unknown): void;
      onMessage(callback: (message: unknown) => void): void;
      removeMessageListener(): void;
    };
  }
}

// Wire incoming IPC messages to the same DOM event useExtensionMessages.ts listens on:
//   window.addEventListener('message', handler)  →  handler reads e.data
if (window.electronAPI) {
  window.electronAPI.onMessage((message: unknown) => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
}

// Exact same export shape as vscodeApi.ts
export const vscode = {
  postMessage(msg: unknown): void {
    window.electronAPI?.postMessage(msg);
  },
};
