const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  postMessage: (msg) => ipcRenderer.send('webview-message', msg),
  onMessage: (cb) => {
    ipcRenderer.on('main-message', (_event, msg) => cb(msg));
  },
  showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  showOpenDialog: (opts) => ipcRenderer.invoke('show-open-dialog', opts),
  showMessage: (opts) => ipcRenderer.invoke('show-message', opts),
  openPath: (p) => ipcRenderer.send('open-path', p),
  getState: (key) => ipcRenderer.invoke('get-state', key),
  setState: (key, val) => ipcRenderer.invoke('set-state', key, val),
});
