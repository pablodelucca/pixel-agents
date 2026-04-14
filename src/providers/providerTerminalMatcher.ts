import { getProviderById } from './providerRegistry.js';
import { PROVIDER_IDS, type ProviderId } from './providerTypes.js';

export function getProviderIdForTerminalName(terminalName: string): ProviderId | undefined {
  return PROVIDER_IDS.find((providerId) => {
    const provider = getProviderById(providerId);
    return provider ? terminalName.startsWith(provider.terminalPrefix) : false;
  });
}
