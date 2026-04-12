import { describe, expect, it } from 'vitest';

import { getEnabledProviders, getProviderById } from '../../src/providers/providerRegistry.js';

describe('providerRegistry', () => {
  it('returns claude and codex in stable toolbar order', () => {
    expect(getEnabledProviders(['claude', 'codex']).map((provider) => provider.id)).toEqual([
      'claude',
      'codex',
    ]);
    expect(getProviderById('claude')?.displayName).toBe('Claude Code');
    expect(getProviderById('codex')?.displayName).toBe('Codex');
  });
});
