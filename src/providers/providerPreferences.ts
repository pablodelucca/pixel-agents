import {
  DEFAULT_PROVIDER_ID,
  isProviderId,
  PROVIDER_IDS,
  type ProviderId,
} from './providerTypes.js';

export interface NormalizedProviderSelection {
  enabledProviders: ProviderId[];
  defaultProvider: ProviderId;
}

export function normalizeProviderSelection(
  enabledProviders: readonly unknown[] | undefined,
  defaultProvider: unknown,
): NormalizedProviderSelection {
  const enabledSet = new Set((enabledProviders ?? []).filter(isProviderId));
  const normalizedEnabled = PROVIDER_IDS.filter((providerId) => enabledSet.has(providerId));
  const safeEnabled = normalizedEnabled.length > 0 ? normalizedEnabled : [DEFAULT_PROVIDER_ID];
  const safeDefault =
    isProviderId(defaultProvider) && safeEnabled.includes(defaultProvider)
      ? defaultProvider
      : safeEnabled[0];

  return {
    enabledProviders: [...safeEnabled],
    defaultProvider: safeDefault,
  };
}
