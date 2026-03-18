import path from 'path';

import { defineConfig } from '@playwright/test';

const artifactsDir = path.join(__dirname, '../test-results/e2e');

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  timeout: 120_000,
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  reporter: [
    ['list'],
    [
      'html',
      {
        // Must be outside outputDir to avoid Playwright clearing artifacts
        outputFolder: path.join(__dirname, '../playwright-report/e2e'),
        open: 'never',
      },
    ],
  ],
  outputDir: artifactsDir,
  // For Electron tests, video/trace are configured in the launch helper.
  // screenshot-on-failure is handled via test.afterEach in fixtures.
  use: {
    video: 'on',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  // Single worker: VS Code windows don't share well in parallel on one display
  workers: 1,
});
