import assert from 'node:assert/strict';
import test from 'node:test';

import { PIXEL_AGENTS_WEBVIEW_OPTIONS } from './webviewRegistrationOptions.js';

test('retains the Pixel Agents webview context when hidden', () => {
  assert.equal(PIXEL_AGENTS_WEBVIEW_OPTIONS.webviewOptions?.retainContextWhenHidden, true);
});
