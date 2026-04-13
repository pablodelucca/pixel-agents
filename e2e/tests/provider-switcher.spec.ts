import { test, expect } from '@playwright/test';
import fs from 'fs';

import { launchVSCode, waitForWorkbench } from '../helpers/launch';
import { clickAddAgent, getPixelAgentsFrame, openPixelAgentsPanel } from '../helpers/webview';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function selectProvider(
  frame: import('@playwright/test').Frame,
  label: string,
): Promise<void> {
  await frame
    .getByRole('button', { name: /Claude Code|Codex/ })
    .first()
    .click();
  await frame
    .getByRole('button', {
      name: new RegExp(`^${escapeRegExp(label)}(?: \\(Selected\\))?$`),
    })
    .last()
    .click();
}

test('provider switcher can spawn one Claude terminal and one Codex terminal', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, mockLogFile, codexMockLogFile } = session;

  test.setTimeout(120_000);

  try {
    await waitForWorkbench(window);
    await openPixelAgentsPanel(window);

    const codexFrame = await getPixelAgentsFrame(window);

    await selectProvider(codexFrame, 'Codex');
    await clickAddAgent(codexFrame);

    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(codexMockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toContain('session-id=');

    await openPixelAgentsPanel(window);
    const claudeFrame = await getPixelAgentsFrame(window);

    await selectProvider(claudeFrame, 'Claude Code');
    await clickAddAgent(claudeFrame);

    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(mockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toContain('session-id=');

    await expect(window.getByText(/Codex #\d+/).first()).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText(/Claude Code #\d+/).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await session.cleanup();
  }
});
