import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '../..');
const VSCODE_PATH_FILE = path.join(REPO_ROOT, '.vscode-test/vscode-executable.txt');
const MOCK_CLAUDE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/mock-claude');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'test-results/e2e');
const APP_CLOSE_TIMEOUT_MS = 10_000;
const WORKBENCH_WINDOW_TIMEOUT_MS = 60_000;
const WINDOW_POLL_INTERVAL_MS = 500;

function logE2E(message: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[e2e] ${message}${suffix}`);
}

function wireProcessLogs(app: ElectronApplication): void {
  const child = app.process();

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  child.stdout?.on('data', (chunk: string | Buffer) => {
    const text = String(chunk).trim();
    if (text) {
      logE2E('VS Code stdout', { text });
    }
  });

  child.stderr?.on('data', (chunk: string | Buffer) => {
    const text = String(chunk).trim();
    if (text) {
      logE2E('VS Code stderr', { text });
    }
  });

  app.on('console', (message) => {
    logE2E('Electron main console', {
      type: message.type(),
      text: message.text(),
    });
  });
}

async function getBrowserWindowSnapshots(
  app: ElectronApplication,
): Promise<Array<Record<string, unknown>>> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      title: window.getTitle(),
      visible: window.isVisible(),
      focused: window.isFocused(),
      destroyed: window.isDestroyed(),
      url: window.webContents.getURL(),
      isLoading: window.webContents.isLoading(),
      isLoadingMainFrame: window.webContents.isLoadingMainFrame(),
      isCrashed: window.webContents.isCrashed(),
    })),
  );
}

function getPageSummary(page: Page): Record<string, unknown> {
  return { url: page.url() };
}

async function resolveWorkbenchWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + WORKBENCH_WINDOW_TIMEOUT_MS;
  let lastWindowCount = -1;
  let lastSnapshotSignature = '';

  while (Date.now() < deadline) {
    const windows = app.windows();
    if (windows.length !== lastWindowCount) {
      lastWindowCount = windows.length;
      logE2E('Observed Electron windows', { count: windows.length });
    }

    const snapshots = await getBrowserWindowSnapshots(app).catch(() => []);
    const snapshotSignature = JSON.stringify(snapshots);
    if (snapshotSignature !== lastSnapshotSignature) {
      lastSnapshotSignature = snapshotSignature;
      logE2E('BrowserWindow snapshot', { windows: snapshots });
    }

    for (const page of windows) {
      if (page.url().includes('/workbench/workbench.html')) {
        logE2E('Matched VS Code workbench page', getPageSummary(page));
        return page;
      }
    }

    const hasWorkbenchSnapshot = snapshots.some((snapshot) =>
      typeof snapshot['url'] === 'string' && snapshot['url'].includes('/workbench/workbench.html'),
    );

    if (hasWorkbenchSnapshot && windows.length > 0) {
      const page = windows[0];
      logE2E('Falling back to first Playwright page for workbench window', getPageSummary(page));
      return page;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    try {
      const page = await app.waitForEvent('window', {
        timeout: Math.min(WINDOW_POLL_INTERVAL_MS, remainingMs),
      });
      logE2E('Electron window event', getPageSummary(page));
    } catch {
      // No new window in this interval; poll existing windows again.
    }
  }

  const summaries = app.windows().map((page) => getPageSummary(page));
  const snapshots = await getBrowserWindowSnapshots(app).catch(() => []);
  logE2E('Timed out resolving VS Code workbench window', {
    pages: summaries,
    browserWindows: snapshots,
  });
  throw new Error('Timed out waiting for the VS Code workbench window');
}

export interface VSCodeSession {
  app: ElectronApplication;
  window: Page;
  /** Isolated HOME directory for this test session. */
  tmpHome: string;
  /** Workspace directory opened in VS Code. */
  workspaceDir: string;
  /** Path to the mock invocations log. */
  mockLogFile: string;
  cleanup: () => Promise<void>;
}

/**
 * Launch VS Code with the Pixel Agents extension loaded in development mode.
 *
 * Uses an isolated temp HOME and injects the mock `claude` binary at the
 * front of PATH so no real Claude CLI is needed.
 */
export async function launchVSCode(testTitle: string): Promise<VSCodeSession> {
  const vscodePath = fs.readFileSync(VSCODE_PATH_FILE, 'utf8').trim();

  // --- Isolated temp directories ---
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-e2e-'));
  const tmpHome = path.join(tmpBase, 'home');
  const workspaceDir = path.join(tmpBase, 'workspace');
  const userDataDir = path.join(tmpBase, 'userdata');
  const mockBinDir = path.join(tmpBase, 'bin');

  fs.mkdirSync(tmpHome, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(mockBinDir, { recursive: true });

  // Copy mock-claude into an isolated bin dir and symlink as 'claude'
  const mockDest = path.join(mockBinDir, 'claude');
  fs.copyFileSync(MOCK_CLAUDE_PATH, mockDest);
  fs.chmodSync(mockDest, 0o755);

  const mockLogFile = path.join(tmpHome, '.claude-mock', 'invocations.log');

  // --- Video output dir ---
  const safeTitle = testTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const videoDir = path.join(ARTIFACTS_DIR, 'videos', safeTitle);
  fs.mkdirSync(videoDir, { recursive: true });

  // --- Environment for VS Code process ---
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    HOME: tmpHome,
    // Prepend mock bin so 'claude' resolves to our mock
    PATH: `${mockBinDir}:${process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin'}`,
    // Prevent VS Code from trying to talk to real accounts / telemetry
    VSCODE_TELEMETRY_DISABLED: '1',
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_ENABLE_STACK_DUMPING: '1',
  };

  // --- VS Code launch args ---
  const args = [
    // Load our extension in dev mode (this overrides the installed version)
    `--extensionDevelopmentPath=${REPO_ROOT}`,
    // Disable all other extensions so tests are isolated
    '--disable-extensions',
    // Isolated user-data (settings, state, etc.)
    `--user-data-dir=${userDataDir}`,
    // Skip interactive prompts
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    // Open the workspace folder
    workspaceDir,
  ];

  const cleanup = async (): Promise<void> => {
    try {
      if (app) {
        const closed = await Promise.race([
          app.close().then(() => true).catch(() => false),
          new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), APP_CLOSE_TIMEOUT_MS);
          }),
        ]);

        if (!closed) {
          logE2E('VS Code app.close() timed out, killing process');
          app.process().kill('SIGKILL');
        }
      }
    } catch {
      // ignore close errors
    }
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  };

  let app: ElectronApplication | undefined;

  try {
    app = await electron.launch({
      executablePath: vscodePath,
      args,
      env,
      cwd: workspaceDir,
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 800 },
      },
      timeout: 60_000,
    });
    logE2E('VS Code launched');
    wireProcessLogs(app);

    const window = await resolveWorkbenchWindow(app);
    logE2E('VS Code workbench window resolved', getPageSummary(window));

    return { app, window, tmpHome, workspaceDir, mockLogFile, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/**
 * Wait for VS Code's workbench to be fully ready before interacting.
 */
export async function waitForWorkbench(window: Page): Promise<void> {
  // VS Code renders a div.monaco-workbench when the shell is ready
  try {
    await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });
  } catch (error) {
    logE2E('Failed waiting for workbench', { url: window.url() });
    throw error;
  }
}
