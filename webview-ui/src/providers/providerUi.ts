export type ProviderId = 'claude' | 'codex';

export interface ProviderOption {
  id: ProviderId;
  label: string;
}

interface OpenAgentMessageArgs {
  providerId: ProviderId;
  bypassPermissions?: boolean;
  folderPath?: string;
}

const PROVIDER_ORDER: ProviderId[] = ['claude', 'codex'];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

function isProviderId(value: unknown): value is ProviderId {
  return value === 'claude' || value === 'codex';
}

export function getEnabledProviderOptions(
  enabledProviders: readonly unknown[] | undefined,
): ProviderOption[] {
  const enabled = new Set((enabledProviders ?? []).filter(isProviderId));
  return PROVIDER_ORDER.filter((providerId) => enabled.has(providerId)).map((providerId) => ({
    id: providerId,
    label: PROVIDER_LABELS[providerId],
  }));
}

export function resolveSelectedProvider(
  enabledProviders: readonly unknown[] | undefined,
  selectedProvider: unknown,
  defaultProvider: unknown,
): ProviderId {
  const options = getEnabledProviderOptions(enabledProviders);
  if (options.length === 0) {
    return 'claude';
  }
  if (isProviderId(selectedProvider) && options.some((option) => option.id === selectedProvider)) {
    return selectedProvider;
  }
  if (isProviderId(defaultProvider) && options.some((option) => option.id === defaultProvider)) {
    return defaultProvider;
  }
  return options[0].id;
}

export function buildOpenAgentMessage({
  providerId,
  bypassPermissions,
  folderPath,
}: OpenAgentMessageArgs): {
  type: 'openAgent';
  providerId: ProviderId;
  bypassPermissions?: boolean;
  folderPath?: string;
} {
  return {
    type: 'openAgent',
    providerId,
    bypassPermissions,
    folderPath,
  };
}
