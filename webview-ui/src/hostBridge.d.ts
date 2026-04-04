interface PixelAgentsHost {
  postMessage(message: unknown): void | Promise<void>;
  openAgent(payload: unknown): void | Promise<void>;
  focusAgent(agentId: number): void | Promise<void>;
  closeAgent(agentId: number): void | Promise<void>;
  configureProvider(provider: unknown, rememberProviderDefault?: boolean): void | Promise<void>;
  onHostMessage(handler: (message: unknown) => void): () => void;
}

interface Window {
  pixelAgentsHost?: PixelAgentsHost;
}
