/**
 * Runtime detection, provider-agnostic
 *
 * Single source of truth for determining whether the webview is running
 * inside an IDE extension (VS Code, Cursor, Windsurf, etc.) or standalone
 * in a browser.
 */

declare function acquireVsCodeApi(): unknown;

export type Runtime = 'vscode' | 'electron' | 'browser';

const hasElectronBridge =
  typeof window !== 'undefined' && typeof window.pixelAgentsHost !== 'undefined';
const hasVsCodeApi = typeof acquireVsCodeApi !== 'undefined';

export const runtime: Runtime = hasVsCodeApi
  ? 'vscode'
  : hasElectronBridge
    ? 'electron'
    : 'browser';

export const isBrowserRuntime = runtime === 'browser';
export const isElectronRuntime = runtime === 'electron';
