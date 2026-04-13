import { describe, expect, it } from 'vitest';

import { normalizeProviderSelection } from '../../src/providers/providerPreferences.js';

describe('normalizeProviderSelection', () => {
  it('keeps enabled providers in stable order and preserves an enabled default', () => {
    expect(normalizeProviderSelection(['codex', 'claude'], 'codex')).toEqual({
      enabledProviders: ['claude', 'codex'],
      defaultProvider: 'codex',
    });
  });

  it('falls back the default provider when the stored one is no longer enabled', () => {
    expect(normalizeProviderSelection(['codex'], 'claude')).toEqual({
      enabledProviders: ['codex'],
      defaultProvider: 'codex',
    });
  });

  it('guarantees at least one enabled provider', () => {
    expect(normalizeProviderSelection([], 'codex')).toEqual({
      enabledProviders: ['claude'],
      defaultProvider: 'claude',
    });
  });
});
