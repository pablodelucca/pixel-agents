import { contextBridge, ipcRenderer } from 'electron';

import type { HostToRendererMessage, OpenAgentPayload, RendererToHostMessage } from './types.js';

type HostMessageHandler = (message: HostToRendererMessage) => void;

const listeners = new Set<HostMessageHandler>();

const bridge = {
  postMessage(message: RendererToHostMessage): Promise<void> {
    return ipcRenderer.invoke('pixel-agents:post-message', message);
  },
  openAgent(payload: OpenAgentPayload): Promise<void> {
    return ipcRenderer.invoke('pixel-agents:post-message', { type: 'openAgent', ...payload });
  },
  focusAgent(agentId: number): Promise<void> {
    return ipcRenderer.invoke('pixel-agents:post-message', { type: 'focusAgent', id: agentId });
  },
  closeAgent(agentId: number): Promise<void> {
    return ipcRenderer.invoke('pixel-agents:post-message', { type: 'closeAgent', id: agentId });
  },
  configureProvider(
    provider: OpenAgentPayload['providerOverride'],
    rememberProviderDefault = true,
  ): Promise<void> {
    if (!provider) return Promise.resolve();
    return ipcRenderer.invoke('pixel-agents:post-message', {
      type: 'configureProvider',
      provider,
      rememberProviderDefault,
    });
  },
  onHostMessage(handler: HostMessageHandler): () => void {
    listeners.add(handler);
    return () => listeners.delete(handler);
  },
};

contextBridge.exposeInMainWorld('pixelAgentsHost', bridge);

ipcRenderer.on('pixel-agents:host-message', (_event, message: HostToRendererMessage) => {
  for (const listener of listeners) {
    listener(message);
  }
  window.postMessage(message, '*');
});
