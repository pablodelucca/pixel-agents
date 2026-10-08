/**
 * Terminal link activation: the scheme allowlist that stands between untrusted
 * terminal output (OSC 8 hyperlinks, printed URLs) and window.open.
 *
 * WHY THIS IS A UNIT TEST, given "E2E over webview unit tests" (CLAUDE.md):
 * it pins a security invariant, not UI internals -- a `javascript:` link that
 * an e2e run would have to click (and then observe NOT executing) is far more
 * directly stated as "window.open was never called".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { terminalLinkOpener } from '../src/terminal/terminalLinks.js';

const open = vi.fn();
const openTerminalLink = terminalLinkOpener(open);
const event = {} as MouseEvent;

beforeEach(() => {
  open.mockReset();
});

describe('terminalLinkOpener', () => {
  it('opens http(s) links in a new tab with no opener and no referrer', () => {
    openTerminalLink(event, 'https://github.com/pixel-agents-hq/pixel-agents');
    openTerminalLink(event, 'http://localhost:5173/');
    expect(open.mock.calls).toEqual([
      ['https://github.com/pixel-agents-hq/pixel-agents', '_blank', 'noopener,noreferrer'],
      ['http://localhost:5173/', '_blank', 'noopener,noreferrer'],
    ]);
  });

  it('ignores every other scheme an OSC 8 link can carry', () => {
    for (const uri of [
      'javascript:alert(document.cookie)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vscode://file/etc/passwd',
      'ssh://evil.example',
    ]) {
      openTerminalLink(event, uri);
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores text that is not a URL at all', () => {
    openTerminalLink(event, 'not a url');
    expect(open).not.toHaveBeenCalled();
  });
});
