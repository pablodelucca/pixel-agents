import * as os from 'os';
import * as path from 'path';

import type {
  ProviderAdapter,
  ProviderLaunchPlan,
  ProviderLaunchRequest,
} from '../providerAdapter.js';
import type { ProviderDescriptor } from '../providerTypes.js';

const CODEX_DESCRIPTOR: ProviderDescriptor = {
  id: 'codex',
  displayName: 'Codex',
  terminalPrefix: 'Codex',
  supportsExternalDiscovery: false,
  supportsStructuredEvents: true,
};

function quoteShellArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildCodexLaunchPlan(input: ProviderLaunchRequest): ProviderLaunchPlan {
  if (!input.serverPort || !input.serverToken) {
    throw new Error('Pixel Agents: Codex launch requires the local event server to be ready.');
  }

  const launchScriptPath = path.join(input.extensionPath, 'dist', 'providers', 'codex-launch.js');

  return {
    command: `node ${quoteShellArg(launchScriptPath)}`,
    env: {
      PIXEL_AGENTS_PROVIDER_ID: 'codex',
      PIXEL_AGENTS_SESSION_ID: input.sessionId,
      PIXEL_AGENTS_SERVER_PORT: String(input.serverPort),
      PIXEL_AGENTS_SERVER_TOKEN: input.serverToken,
      PIXEL_AGENTS_CWD: input.cwd,
      PIXEL_AGENTS_BYPASS_PERMISSIONS: input.bypassPermissions ? '1' : '0',
    },
  };
}

export const codexProvider: ProviderAdapter = {
  id: 'codex',
  descriptor: CODEX_DESCRIPTOR,
  usesTranscriptFile: false,
  terminalLabel(index: number): string {
    return `${CODEX_DESCRIPTOR.terminalPrefix} #${index}`;
  },
  matchesTerminalLabel(terminalName: string): boolean {
    return terminalName.startsWith(CODEX_DESCRIPTOR.terminalPrefix);
  },
  buildLaunchPlan: buildCodexLaunchPlan,
  getProjectDir(cwd?: string): string {
    return cwd || os.homedir();
  },
};
