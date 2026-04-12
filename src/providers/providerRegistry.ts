import {
  DEFAULT_PROVIDER_ID,
  isProviderId,
  PROVIDER_IDS,
  type ProviderDescriptor,
  type ProviderId,
} from './providerTypes.js';

const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    terminalPrefix: 'Claude Code',
    supportsExternalDiscovery: true,
    supportsStructuredEvents: true,
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    terminalPrefix: 'Codex',
    supportsExternalDiscovery: true,
    supportsStructuredEvents: true,
  },
};

export function getProviderById(providerId: ProviderId | string): ProviderDescriptor | undefined {
  return isProviderId(providerId) ? PROVIDERS[providerId] : undefined;
}

export function getEnabledProviders(
  enabledProviderIds: readonly ProviderId[] | readonly string[] | undefined,
): ProviderDescriptor[] {
  const enabled = new Set((enabledProviderIds ?? []).filter(isProviderId));
  return PROVIDER_IDS.map((providerId) => PROVIDERS[providerId]).filter((provider) =>
    enabled.has(provider.id),
  );
}

export function getDefaultProvider(): ProviderDescriptor {
  return PROVIDERS[DEFAULT_PROVIDER_ID];
}
