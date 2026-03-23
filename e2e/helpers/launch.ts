import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '../..');
const VSCODE_PATH_FILE = path.join(REPO_ROOT, '.vscode-test/vscode-executable.txt');
const MOCK_CLAUDE_PATH = path.join(REPO_ROOT, 'e2e/fixtures/mock-claude');
const ARTIFACTS_DIR = path.join(REPO_ROOT, 'test-results/e2e');

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

  // macOS: create a temporary keychain so the OS doesn't show "Keychain Not Found" dialog.
  // The isolated HOME has no keychain, and VS Code/Electron's safeStorage triggers a system prompt.
  if (process.platform === 'darwin') {
    const keychainDir = path.join(tmpHome, 'Library', 'Keychains');
    fs.mkdirSync(keychainDir, { recursive: true });
    const keychainPath = path.join(keychainDir, 'login.keychain-db');
    try {
      const { execSync } = require('child_process');
      execSync(`security create-keychain -p "" "${keychainPath}"`, { stdio: 'ignore' });
      execSync(`security default-keychain -s "${keychainPath}"`, {
        stdio: 'ignore',
        env: { ...process.env, HOME: tmpHome },
      });
    } catch {
      // keychain creation failure is non-fatal, test may still work
    }
  }

  // Copy mock-claude into an isolated bin dir and symlink as 'claude'
  const mockDest = path.join(mockBinDir, 'claude');
  fs.copyFileSync(MOCK_CLAUDE_PATH, mockDest);
  fs.chmodSync(mockDest, 0o755);

  // macOS: VS Code's integrated terminal resolves PATH from the login shell,
  // ignoring the process env. Define a custom terminal profile that uses a
  // non-login shell with our mock bin dir in PATH. On Linux the process env
  // propagates directly, so no custom profile is needed.
  if (process.platform === 'darwin') {
    const userSettingsDir = path.join(userDataDir, 'User');
    fs.mkdirSync(userSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSettingsDir, 'settings.json'),
      JSON.stringify(
        {
          'terminal.integrated.profiles.osx': {
            e2e: {
              path: '/bin/zsh',
              args: ['--no-globalrcs'],
              env: {
                PATH: `${mockBinDir}:/usr/local/bin:/usr/bin:/bin`,
                HOME: tmpHome,
                ZDOTDIR: tmpHome,
              },
            },
          },
          'terminal.integrated.defaultProfile.osx': 'e2e',
          'terminal.integrated.inheritEnv': false,
        },
        null,
        2,
      ),
    );
  }

  const mockLogFile = path.join(tmpHome, '.claude-mock', 'invocations.log');

  // --- Video output dir ---
  const safeTitle = testTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const videoDir = path.join(ARTIFACTS_DIR, 'videos', safeTitle);
  fs.mkdirSync(videoDir, { recursive: true });

  // --- Environment for VS Code process ---
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: tmpHome,
    // Prepend mock bin so 'claude' resolves to our mock
    PATH: `${mockBinDir}:${process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin'}`,
    // Prevent VS Code from trying to talk to real accounts / telemetry
    VSCODE_TELEMETRY_DISABLED: '1',
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
    // Open the workspace folder
    workspaceDir,
  ];

  const cleanup = async (): Promise<void> => {
    try {
      if (app) {
        await app.close();
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

    // Electron can expose the window before the page lifecycle events settle.
    // The test waits for `.monaco-workbench`, so returning the window here is
    // more reliable than waiting on `domcontentloaded` in CI.
    const window = await app.firstWindow();

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
  await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });
}
