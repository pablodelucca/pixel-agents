import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  postMessage: (message: unknown): void => {
    ipcRenderer.send('webview-message', message);
  },
  onMessage: (callback: (message: unknown) => void): void => {
    ipcRenderer.on('main-message', (_event, message: unknown) => {
      callback(message);
    });
  },
  removeMessageListener: (): void => {
    ipcRenderer.removeAllListeners('main-message');
  },
});
