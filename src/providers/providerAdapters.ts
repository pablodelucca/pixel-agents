import { claudeProvider } from './claude/claudeProvider.js';
import { codexProvider } from './codex/codexProvider.js';
import type { ProviderAdapter } from './providerAdapter.js';
import { isProviderId, type ProviderId } from './providerTypes.js';

const providerAdapters: Partial<Record<ProviderId, ProviderAdapter>> = {
  claude: claudeProvider,
  codex: codexProvider,
};

export function getProviderAdapter(providerId: ProviderId | string): ProviderAdapter | undefined {
  return isProviderId(providerId) ? providerAdapters[providerId] : undefined;
}

export function getProviderWithExternalDiscovery(
  providerId: ProviderId | string,
): ProviderAdapter | undefined {
  const adapter = getProviderAdapter(providerId);
  return adapter?.descriptor.supportsExternalDiscovery ? adapter : undefined;
}

export function getExternalDiscoveryAdapters(): ProviderAdapter[] {
  return Object.values(providerAdapters).filter(
    (adapter): adapter is ProviderAdapter =>
      !!adapter && adapter.descriptor.supportsExternalDiscovery,
  );
}

export function findProviderAdapterByTerminalName(
  terminalName: string,
): ProviderAdapter | undefined {
  return Object.values(providerAdapters).find(
    (adapter): adapter is ProviderAdapter =>
      !!adapter && adapter.matchesTerminalLabel(terminalName),
  );
}
