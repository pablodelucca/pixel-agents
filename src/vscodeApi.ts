// Web mode - no Electron/VSCode API needed

// VS Code API type (compat - now just a no-op)
type VsCodeApi = { postMessage(msg: unknown): void };

// Always false since we're web-only
export const isStandalone = false;

// Mock API - no-op in web mode
const mockVsCode: VsCodeApi = {
  postMessage: (_msg: unknown) => {
    // No-op in web mode
  },
};

// Export mock API
export const vscode: VsCodeApi = mockVsCode;

// No-op subscriptions (not needed in web mode)
export function subscribeToOpenClawEvents(_callback: (data: unknown) => void): (() => void) | null {
  return null;
}

// No agents from gateway (we use server-based agents instead)
export async function fetchAgentsFromGateway(): Promise<Array<{ id: number; name: string; emoji: string }>> {
  return [];
}

// No OpenClaw config from Electron
export async function getOpenClawConfig(): Promise<null> {
  return null;
}
