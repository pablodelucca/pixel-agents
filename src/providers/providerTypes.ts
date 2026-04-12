export type ProviderId = 'claude' | 'codex';

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  terminalPrefix: string;
  supportsExternalDiscovery: boolean;
  supportsStructuredEvents: boolean;
}

export const DEFAULT_PROVIDER_ID: ProviderId = 'claude';

export const PROVIDER_IDS = ['claude', 'codex'] as const satisfies readonly ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return value === 'claude' || value === 'codex';
}
