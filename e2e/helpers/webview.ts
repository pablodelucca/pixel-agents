import type { Frame, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const WEBVIEW_TIMEOUT_MS = 30_000;
const PANEL_OPEN_TIMEOUT_MS = 15_000;

/**
 * Open the Pixel Agents panel via the Command Palette and wait for the
 * "Pixel Agents: Show Panel" command to execute.
 */
export async function openPixelAgentsPanel(window: Page): Promise<void> {
  // Open command palette (Ctrl+Shift+P / F1)
  await window.keyboard.press('F1');
  await window.waitForSelector('.quick-input-widget', { timeout: PANEL_OPEN_TIMEOUT_MS });

  // Type the command
  await window.keyboard.type('Pixel Agents: Show Panel');
  await window.waitForSelector('.quick-input-list .monaco-list-row', {
    timeout: PANEL_OPEN_TIMEOUT_MS,
  });
  await window.keyboard.press('Enter');

  // Wait for the panel container to appear
  await window.waitForSelector('[id="workbench.panel.bottom"]', {
    timeout: PANEL_OPEN_TIMEOUT_MS,
  }).catch(() => {
    // Panel might not use this id; just continue
  });
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
