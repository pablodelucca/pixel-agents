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

function logStep(message: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[e2e] ${message}${suffix}`);
}

async function runStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  logStep(`START ${label}`);
  try {
    const result = await action();
    logStep(`DONE ${label}`, { durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    logStep(`FAIL ${label}`, {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

test('clicking + Agent spawns mock claude and creates a JSONL session file', async ({}, testInfo) => {
  test.setTimeout(120_000);

  logStep('Launching VS Code session', { title: testInfo.title });
  const session = await launchVSCode(testInfo.title);
  const { window, tmpHome, workspaceDir, mockLogFile } = session;
  const runVideo = window.video();

  try {
    // 1. Wait for VS Code workbench to be ready
    await runStep('waitForWorkbench', () => waitForWorkbench(window));

    // 2. Open the Pixel Agents panel
    await runStep('openPixelAgentsPanel', () => openPixelAgentsPanel(window));

    // 3. Find the webview frame and click + Agent
    const frame = await runStep('getPixelAgentsFrame', () => getPixelAgentsFrame(window));
    logStep('Pixel Agents frame resolved', { url: frame.url() });
    await runStep('clickAddAgent', () => clickAddAgent(frame));

    // 4. Assert: mock claude was invoked
    //    The mock script writes to $HOME/.claude-mock/invocations.log
    await runStep('waitForMockClaudeInvocation', async () => {
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
    });

    const invocationLog = fs.readFileSync(mockLogFile, 'utf8');
    expect(invocationLog).toContain('session-id=');
    await testInfo.attach('mock-claude-invocations', {
      body: invocationLog,
      contentType: 'text/plain',
    });

    // 5. Assert: JSONL session file was created
    //    Compute the project hash the same way agentManager.ts does:
    //    workspacePath.replace(/[^a-zA-Z0-9-]/g, '-')
    const projectHash = workspaceDir.replace(/[^a-zA-Z0-9-]/g, '-');
    const projectDir = path.join(tmpHome, '.claude', 'projects', projectHash);

    await runStep('waitForJsonlSessionFile', async () => {
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
    });

    const jsonlFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
    await testInfo.attach('jsonl-files', {
      body: jsonlFiles.join('\n'),
      contentType: 'text/plain',
    });

    // 6. Assert: terminal "Claude Code #1" is visible in VS Code UI
    //    VS Code renders the terminal name as visible text in the tab bar.
    const terminalTab = window.getByText(/Claude Code #\d+/);
    await runStep('waitForTerminalTab', async () => {
      await expect(terminalTab.first()).toBeVisible({ timeout: 15_000 });
    });
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
      logStep('Saved final screenshot', { path: screenshotPath });
      await testInfo.attach('final-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    } catch {
      // screenshot failure is non-fatal
    }

    await session.cleanup();
    logStep('Session cleanup finished');

    if (runVideo) {
      try {
        const videoPath = testInfo.outputPath('run-video.webm');
        await runVideo.saveAs(videoPath);
        logStep('Saved run video', { path: videoPath });
        await testInfo.attach('run-video', {
          path: videoPath,
          contentType: 'video/webm',
        });
      } catch {
        // video attachment failure is non-fatal
      }
    }
  }
});
