// Electron standalone mode - uses Electron IPC instead of VS Code API
// Types are defined in ./types/electron.d.ts

// VS Code API type (compat)
type VsCodeApi = { postMessage(msg: unknown): void };

// Check if running in Electron
export const isStandalone = typeof window !== 'undefined' && !!window.electronAPI;

// VS Code compatible API wrapper
const electronVsCode: VsCodeApi = {
  postMessage: (msg: unknown) => {
    if (!window.electronAPI) {
      console.warn('[Electron] electronAPI not available');
      return;
    }

    const message = msg as { type: string; id?: number; message?: string };
    
    switch (message.type) {
      case 'focusAgent':
        if (message.id !== undefined) {
          window.electronAPI.focusAgent(message.id);
        }
        break;
      case 'closeAgent':
        if (message.id !== undefined) {
          window.electronAPI.closeAgent(message.id);
        }
        break;
      case 'sendMessage':
        if (message.id !== undefined && message.message) {
          window.electronAPI.sendMessage(message.id, message.message);
        }
        break;
      default:
        console.log('[Electron] Unknown message type:', message.type);
    }
  },
};

// Mock API for fallback (pure web mode)
const mockVsCode: VsCodeApi = {
  postMessage: (_msg: unknown) => {
    // No-op in standalone web mode
  },
};

// Export VS Code compatible API
export const vscode: VsCodeApi = window.electronAPI ? electronVsCode : mockVsCode;

// Subscribe to OpenClaw events (Electron only)
export function subscribeToOpenClawEvents(callback: (data: unknown) => void): (() => void) | null {
  if (window.electronAPI?.onOpenClawEvent) {
    return window.electronAPI.onOpenClawEvent(callback);
  }
  return null;
}

// Fetch agents from gateway (Electron only)
export async function fetchAgentsFromGateway(): Promise<Array<{ id: number; name: string; emoji: string }>> {
  if (window.electronAPI?.fetchAgents) {
    return window.electronAPI.fetchAgents();
  }
  return [];
}

// Get OpenClaw config (Electron only)
export async function getOpenClawConfig(): Promise<OpenClawConfig | null> {
  if (window.electronAPI?.getConfig) {
    return window.electronAPI.getConfig();
  }
  return null;
}

// Type alias for local use
type OpenClawConfig = NonNullable<Window['electronAPI']> extends { 
  getConfig: () => Promise<infer T> 
} ? T : never;
