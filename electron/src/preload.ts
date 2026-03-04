import { contextBridge, ipcRenderer } from 'electron'

// Expose IPC bridge to the renderer process
// This matches the interface expected by webview-ui/src/vscodeApi.ts
contextBridge.exposeInMainWorld('__pixelAgentsBridge', {
  postMessage: (msg: unknown) => {
    ipcRenderer.send('webview-message', msg)
  },
})

// Forward messages from main process to renderer via window.postMessage
// This works because useExtensionMessages.ts already listens on window 'message' events
ipcRenderer.on('extension-message', (_event, msg) => {
  window.postMessage(msg, '*')
})
