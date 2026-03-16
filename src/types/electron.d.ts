// Electron API types exposed via contextBridge

interface ElectronAPI {
  getConfig: () => Promise<OpenClawConfig>;
  getGatewayInfo: () => Promise<{ url: string; token: string }>;
  fetchAgents: () => Promise<Array<{ id: number; name: string; emoji: string }>>;
  sendMessage: (agentId: number, message: string) => Promise<boolean>;
  focusAgent: (agentId: number) => Promise<boolean>;
  closeAgent: (agentId: number) => Promise<boolean>;
  onOpenClawEvent: (callback: (data: unknown) => void) => () => void;
  platform: string;
}

interface OpenClawConfig {
  gateway?: {
    port?: number;
    auth?: {
      token?: string;
    };
  };
  agents?: {
    list?: Array<{
      id: string;
      name?: string;
      identity?: {
        name?: string;
        emoji?: string;
      };
    }>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
