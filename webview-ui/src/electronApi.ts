declare global {
  interface Window {
    electronAPI: {
      postMessage: (msg: unknown) => void;
      onMessage: (cb: (msg: unknown) => void) => void;
      showSaveDialog: (opts: unknown) => Promise<unknown>;
      showOpenDialog: (opts: unknown) => Promise<unknown>;
      showMessage: (opts: unknown) => Promise<unknown>;
      openPath: (path: string) => void;
      getState: (key: string) => Promise<unknown>;
      setState: (key: string, val: unknown) => Promise<void>;
    };
  }
}

// Bridge IPC messages from main process into window 'message' events
// so useExtensionMessages.ts works without changes
window.electronAPI.onMessage((msg: unknown) => {
  window.dispatchEvent(new MessageEvent('message', { data: msg }));
});

export const electronApi = {
  postMessage(msg: unknown): void {
    window.electronAPI.postMessage(msg);
  },
};
