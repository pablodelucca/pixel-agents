/**
 * E2E: Clicking "+ Agent" in the Pixel Agents webview spawns a mock Claude terminal.
 *
 * Assertions:
 *   1. The mock `claude` binary was invoked (invocations.log exists and is non-empty).
 *   2. The expected JSONL session file was created in the isolated HOME.
 *   3. A VS Code terminal named "Claude Code #1" appears in the workbench.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { launchVSCode, waitForWorkbench } from '../helpers/launch';
import { clickAddAgent, getPixelAgentsFrame, openPixelAgentsPanel } from '../helpers/webview';

test('clicking + Agent spawns mock claude and creates a JSONL session file', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, tmpHome, workspaceDir, mockLogFile } = session;

  test.setTimeout(120_000);

  try {
    // 1. Wait for VS Code workbench to be ready
    await waitForWorkbench(window);

    // 2. Open the Pixel Agents panel
    await openPixelAgentsPanel(window);

    // 3. Find the webview frame and click + Agent
    const frame = await getPixelAgentsFrame(window);
    await clickAddAgent(frame);

    // 4. Assert: mock claude was invoked
    //    The mock script writes to $HOME/.claude-mock/invocations.log
    await expect
      .poll(
        () => {
          try {
            const content = fs.readFileSync(mockLogFile, 'utf8');
            return content.trim().length > 0;
          } catch {
            return false;
          }
        },
        {
          message: `Expected invocations.log at ${mockLogFile} to be non-empty`,
          timeout: 20_000,
          intervals: [500, 1000],
        },
      )
      .toBe(true);

    const invocationLog = fs.readFileSync(mockLogFile, 'utf8');
    expect(invocationLog).toContain('session-id=');
    testInfo.attach('mock-claude-invocations', {
      body: invocationLog,
      contentType: 'text/plain',
    });

    // 5. Assert: JSONL session file was created
    //    Compute the project hash the same way agentManager.ts does:
    //    workspacePath.replace(/[^a-zA-Z0-9-]/g, '-')
    const projectHash = workspaceDir.replace(/[^a-zA-Z0-9-]/g, '-');
    const projectDir = path.join(tmpHome, '.claude', 'projects', projectHash);

    await expect
      .poll(
        () => {
          try {
            const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
            return files.length > 0;
          } catch {
            return false;
          }
        },
        {
          message: `Expected at least one .jsonl file in ${projectDir}`,
          timeout: 20_000,
          intervals: [500, 1000],
        },
      )
      .toBe(true);

    const jsonlFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
    testInfo.attach('jsonl-files', {
      body: jsonlFiles.join('\n'),
      contentType: 'text/plain',
    });

    // 6. Assert: terminal "Claude Code #1" is visible in VS Code UI
    //    VS Code renders the terminal name as visible text in the tab bar.
    const terminalTab = window.getByText(/Claude Code #\d+/);
    await expect(terminalTab.first()).toBeVisible({ timeout: 15_000 });
  } finally {
    // Save a screenshot of the final state regardless of outcome
    const screenshotPath = path.join(
      __dirname,
      '../../test-results/e2e',
      `agent-spawn-final-${Date.now()}.png`,
    );
    try {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await window.screenshot({ path: screenshotPath });
      testInfo.attach('final-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } catch {
      // screenshot failure is non-fatal
    }

    await session.cleanup();
  }
});
