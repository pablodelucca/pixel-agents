import { describe, expect, it } from 'vitest';

import { getProviderIdForTerminalName } from '../../src/providers/providerTerminalMatcher.js';

describe('getProviderIdForTerminalName', () => {
  it('resolves adapter-owned terminal labels', () => {
    expect(getProviderIdForTerminalName('Claude Code #7')).toBe('claude');
  });

  it('ignores terminals that do not belong to a provider', () => {
    expect(getProviderIdForTerminalName('bash')).toBeUndefined();
  });
});
