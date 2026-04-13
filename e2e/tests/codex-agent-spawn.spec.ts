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

test('switching to Codex and clicking + Agent spawns the mock codex terminal', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, codexMockLogFile } = session;

  test.setTimeout(120_000);

  try {
    await waitForWorkbench(window);
    await openPixelAgentsPanel(window);

    const frame = await getPixelAgentsFrame(window);
    await selectProvider(frame, 'Codex');
    await clickAddAgent(frame);

    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(codexMockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        {
          message: `Expected mock Codex invocation log at ${codexMockLogFile}`,
          timeout: 20_000,
          intervals: [500, 1000],
        },
      )
      .toContain('session-id=');
    await expect(window.getByText(/Codex #\d+/).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await session.cleanup();
  }
});

test('codex spawnAgent activity appears as a subagent in debug view', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, codexMockLogFile } = session;

  test.setTimeout(120_000);

  try {
    await waitForWorkbench(window);
    await openPixelAgentsPanel(window);

    const frame = await getPixelAgentsFrame(window);
    await selectProvider(frame, 'Codex');
    await clickAddAgent(frame);

    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(codexMockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        {
          message: `Expected mock Codex invocation log at ${codexMockLogFile}`,
          timeout: 20_000,
          intervals: [500, 1000],
        },
      )
      .toContain('session-id=');

    await expect(window.getByText(/Codex #\d+/).first()).toBeVisible({ timeout: 15_000 });

    await openPixelAgentsPanel(window);
    const activeFrame = await getPixelAgentsFrame(window);
    await activeFrame.getByRole('button', { name: 'Settings' }).click();
    await activeFrame.getByRole('button', { name: 'Debug View' }).click();
    await activeFrame
      .locator('div.fixed')
      .filter({ has: activeFrame.getByText('Settings') })
      .getByRole('button', { name: /^x$/ })
      .click();

    await expect(activeFrame.getByRole('heading', { name: 'Debug View' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(activeFrame.getByText('Subtask: Inspect src/providers')).toBeVisible({
      timeout: 15_000,
    });
    await expect(activeFrame.getByText('Searching code')).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await session.cleanup();
  }
});

test('codex spawnAgent can surface six cloned agents in debug view', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, codexMockLogFile } = session;

  test.setTimeout(120_000);

  const expectedSubtasks = [
    'Subtask: Inspect providerTypes',
    'Subtask: Inspect providerRegistry',
    'Subtask: Inspect claudeProvider',
    'Subtask: Inspect codexProvider',
    'Subtask: Inspect providerEventRouter',
    'Subtask: Inspect codexEventMapper',
  ];
  const expectedReads = [
    'Reading providerTypes.ts',
    'Reading providerRegistry.ts',
    'Reading claudeProvider.ts',
    'Reading codexProvider.ts',
    'Reading providerEventRouter.ts',
    'Reading codexEventMapper.ts',
  ];

  try {
    await waitForWorkbench(window);
    await openPixelAgentsPanel(window);

    const frame = await getPixelAgentsFrame(window);
    await selectProvider(frame, 'Codex');
    await clickAddAgent(frame);

    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(codexMockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        {
          message: `Expected mock Codex multi-spawn scenario in ${codexMockLogFile}`,
          timeout: 20_000,
          intervals: [500, 1000],
        },
      )
      .toContain('trace=scenario=spawn-agent-many');

    await expect(window.getByText(/Codex #\d+/).first()).toBeVisible({ timeout: 15_000 });

    await openPixelAgentsPanel(window);
    const activeFrame = await getPixelAgentsFrame(window);
    await activeFrame.getByRole('button', { name: 'Settings' }).click();
    await activeFrame.getByRole('button', { name: 'Debug View' }).click();
    await activeFrame
      .locator('div.fixed')
      .filter({ has: activeFrame.getByText('Settings') })
      .getByRole('button', { name: /^x$/ })
      .click();

    await expect(activeFrame.getByRole('heading', { name: 'Debug View' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(activeFrame.getByText(/^Subtask:/)).toHaveCount(6, { timeout: 15_000 });

    for (const subtask of expectedSubtasks) {
      await expect(activeFrame.getByText(subtask)).toBeVisible({ timeout: 15_000 });
    }
    for (const readStatus of expectedReads) {
      await expect(activeFrame.getByText(readStatus)).toBeVisible({ timeout: 15_000 });
    }
  } finally {
    await session.cleanup();
  }
});
