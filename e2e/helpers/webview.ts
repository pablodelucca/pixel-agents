import type { Frame, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const WEBVIEW_TIMEOUT_MS = 30_000;
const PANEL_OPEN_TIMEOUT_MS = 15_000;
const MIN_PANEL_HEIGHT_PX = 320;

function logE2E(message: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[e2e] ${message}${suffix}`);
}

async function runCommand(window: Page, command: string): Promise<void> {
  logE2E('Running VS Code command', { command });
  await window.keyboard.press('F1');
  await window.waitForSelector('.quick-input-widget', { timeout: PANEL_OPEN_TIMEOUT_MS });
  await window.keyboard.type(command);
  await window.waitForSelector('.quick-input-list .monaco-list-row', {
    timeout: PANEL_OPEN_TIMEOUT_MS,
  });
  await window.keyboard.press('Enter');
  await window.waitForSelector('.quick-input-widget', {
    state: 'hidden',
    timeout: PANEL_OPEN_TIMEOUT_MS,
  }).catch(() => {
    // Some commands update layout without immediately dismissing quick input.
  });
}

async function getPanelHeight(window: Page): Promise<number> {
  return window.evaluate(() => {
    const panel =
      document.querySelector<HTMLElement>('[id="workbench.panel.bottom"]') ??
      document.querySelector<HTMLElement>('.part.panel');

    return Math.round(panel?.getBoundingClientRect().height ?? 0);
  });
}

async function ensurePanelIsLarge(window: Page): Promise<void> {
  if ((await getPanelHeight(window)) > MIN_PANEL_HEIGHT_PX) {
    logE2E('Panel already large enough', { height: await getPanelHeight(window) });
    return;
  }

  logE2E('Panel too small, maximizing', { height: await getPanelHeight(window) });
  await runCommand(window, 'View: Toggle Maximized Panel');

  await expect
    .poll(() => getPanelHeight(window), {
      message: 'Expected the bottom panel to be resized for the Pixel Agents webview',
      timeout: PANEL_OPEN_TIMEOUT_MS,
      intervals: [250, 500, 1000],
    })
    .toBeGreaterThan(MIN_PANEL_HEIGHT_PX);

  logE2E('Panel resized', { height: await getPanelHeight(window) });
}

/**
 * Open the Pixel Agents panel via the Command Palette and wait for the
 * "Pixel Agents: Show Panel" command to execute.
 */
export async function openPixelAgentsPanel(window: Page): Promise<void> {
  await runCommand(window, 'Pixel Agents: Show Panel');

  // Wait for the panel container to appear
  await window.waitForSelector('[id="workbench.panel.bottom"], .part.panel', {
    timeout: PANEL_OPEN_TIMEOUT_MS,
  }).catch(() => {
    // Panel might not use this id; just continue
  });

  await ensurePanelIsLarge(window);
}

/**
 * Find and return the Pixel Agents webview frame.
 *
 * VS Code renders WebviewViewProvider content in an <iframe> whose URL
 * starts with "vscode-webview://". Because VS Code can have multiple
 * webviews, we wait until one frame exposes the "+ Agent" button before
 * returning it.
 */
export async function getPixelAgentsFrame(window: Page): Promise<Frame> {
  const deadline = Date.now() + WEBVIEW_TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const frame of window.frames()) {
      const url = frame.url();
      if (!url.startsWith('vscode-webview://')) continue;

      try {
        const btn = await frame.waitForSelector('button:has-text("+ Agent")', { timeout: 2_000 });
        if (btn) return frame;
      } catch {
        // not this frame, keep looking
      }
    }

    // Wait for a new frame to be attached
    await window.waitForTimeout(500);
  }

  const frameUrls = window.frames().map((frame) => frame.url());
  logE2E('Timed out waiting for Pixel Agents webview frame', { frameUrls });
  throw new Error('Timed out waiting for Pixel Agents webview frame with "+ Agent" button');
}

/**
 * Click "+ Agent" in the webview and wait for the call to be dispatched.
 */
export async function clickAddAgent(frame: Frame): Promise<void> {
  const btn = frame.locator('button', { hasText: '+ Agent' });
  await expect(btn).toBeVisible({ timeout: WEBVIEW_TIMEOUT_MS });
  await btn.click();
}
