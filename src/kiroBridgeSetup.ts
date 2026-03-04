/**
 * Kiro Bridge Setup — auto-scaffolds hooks and bridge script on activation.
 *
 * When the extension activates in a workspace, checks whether the Kiro hooks
 * and bridge shell script exist. If not, offers to create them so the Pixel
 * Agents integration works out of the box.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ── Hook definitions (embedded so the VSIX is self-contained) ──

function makeHookCommand(scriptPath: string, event: string): string {
  return `bash ${scriptPath} ${event}`;
}

function getHookDefinitions(scriptPath: string): Record<string, object> {
  return {
    'pixel-agents-prompt.kiro.hook': {
      enabled: true,
      name: 'Pixel Agents: Prompt Start',
      description:
        'Writes a user record to the Pixel Agents JSONL file when a new prompt is submitted.',
      version: '1',
      when: { type: 'promptSubmit' },
      then: { type: 'runCommand', command: makeHookCommand(scriptPath, 'init') },
    },
    'pixel-agents-tool-start.kiro.hook': {
      enabled: true,
      name: 'Pixel Agents: Tool Start',
      description: 'Writes a tool_use record before each tool execution.',
      version: '1',
      when: { type: 'preToolUse', toolTypes: ['read', 'write', 'shell'] },
      then: { type: 'runCommand', command: makeHookCommand(scriptPath, 'tool-start') },
    },
    'pixel-agents-tool-done.kiro.hook': {
      enabled: true,
      name: 'Pixel Agents: Tool Done',
      description: 'Writes a tool_result record after each tool execution completes.',
      version: '1',
      when: { type: 'postToolUse', toolTypes: ['read', 'write', 'shell'] },
      then: { type: 'runCommand', command: makeHookCommand(scriptPath, 'tool-done') },
    },
    'pixel-agents-agent-stop.kiro.hook': {
      enabled: true,
      name: 'Pixel Agents: Agent Done',
      description:
        'Writes a turn_duration system record when the agent finishes.',
      version: '1',
      when: { type: 'agentStop' },
      then: { type: 'runCommand', command: makeHookCommand(scriptPath, 'agent-stop') },
    },
  };
}

// ── Bridge script content (read from bundled file at runtime) ──

const BRIDGE_SCRIPT_FILENAME = 'pixel-agents-bridge.sh';

/** Relative path where the bridge script is placed inside .kiro/scripts/ */
const BRIDGE_SCRIPT_REL = `.kiro/scripts/${BRIDGE_SCRIPT_FILENAME}`;

/** The four hook filenames */
const HOOK_FILES = [
  'pixel-agents-prompt.kiro.hook',
  'pixel-agents-tool-start.kiro.hook',
  'pixel-agents-tool-done.kiro.hook',
  'pixel-agents-agent-stop.kiro.hook',
];

/**
 * Check if the Kiro bridge is already set up in the given workspace folder.
 */
function isBridgeSetUp(workspaceRoot: string): boolean {
  const bridgePath = path.join(workspaceRoot, BRIDGE_SCRIPT_REL);
  if (!fs.existsSync(bridgePath)) return false;

  const hooksDir = path.join(workspaceRoot, '.kiro', 'hooks');
  for (const hookFile of HOOK_FILES) {
    if (!fs.existsSync(path.join(hooksDir, hookFile))) return false;
  }
  return true;
}

/**
 * Scaffold the bridge script and hooks into the workspace.
 */
function scaffoldBridge(workspaceRoot: string, extensionPath: string): void {
  const scriptDir = path.join(workspaceRoot, '.kiro', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });

  // Copy bridge script from bundled location or use the one from scripts/kiro-bridge/
  const bundledScript = path.join(extensionPath, 'dist', 'bridge', BRIDGE_SCRIPT_FILENAME);
  const srcScript = path.join(extensionPath, 'scripts', 'kiro-bridge', BRIDGE_SCRIPT_FILENAME);
  const destScript = path.join(scriptDir, BRIDGE_SCRIPT_FILENAME);

  let scriptSource: string | null = null;
  if (fs.existsSync(bundledScript)) {
    scriptSource = bundledScript;
  } else if (fs.existsSync(srcScript)) {
    scriptSource = srcScript;
  }

  if (scriptSource) {
    fs.copyFileSync(scriptSource, destScript);
  } else {
    // Read from the workspace's own scripts/ if available (dev mode)
    const wsScript = path.join(workspaceRoot, 'scripts', 'kiro-bridge', BRIDGE_SCRIPT_FILENAME);
    if (fs.existsSync(wsScript)) {
      fs.copyFileSync(wsScript, destScript);
    } else {
      console.error('[KiroBridge] Could not find bridge script to copy');
      return;
    }
  }

  // Make executable
  try {
    fs.chmodSync(destScript, 0o755);
  } catch {
    // chmod may fail on Windows, that's ok
  }

  // Write hooks
  const hooksDir = path.join(workspaceRoot, '.kiro', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookDefs = getHookDefinitions(BRIDGE_SCRIPT_REL);
  for (const [filename, content] of Object.entries(hookDefs)) {
    const hookPath = path.join(hooksDir, filename);
    fs.writeFileSync(hookPath, JSON.stringify(content, null, 2) + '\n', 'utf-8');
  }

  console.log('[KiroBridge] ✅ Scaffolded bridge script and 4 hooks');
}

/**
 * Remove the bridge script and hooks from the workspace.
 */
function removeBridge(workspaceRoot: string): void {
  const hooksDir = path.join(workspaceRoot, '.kiro', 'hooks');
  for (const hookFile of HOOK_FILES) {
    const p = path.join(hooksDir, hookFile);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const scriptPath = path.join(workspaceRoot, BRIDGE_SCRIPT_REL);
  if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

  console.log('[KiroBridge] Removed bridge script and hooks');
}

/**
 * Called on extension activation. Checks if bridge is set up and offers to create it.
 */
export async function checkAndOfferBridgeSetup(
  context: vscode.ExtensionContext,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  // Check if .kiro directory exists (indicates Kiro IDE)
  const kiroDir = path.join(workspaceRoot, '.kiro');
  if (!fs.existsSync(kiroDir)) return;

  if (isBridgeSetUp(workspaceRoot)) return;

  const choice = await vscode.window.showInformationMessage(
    'Pixel Agents: Set up Kiro bridge hooks for agent activity tracking?',
    'Setup',
    'Dismiss',
  );

  if (choice === 'Setup') {
    try {
      scaffoldBridge(workspaceRoot, context.extensionPath);
      vscode.window.showInformationMessage(
        'Pixel Agents: Kiro bridge is ready! Agent activity will now appear in the pixel office.',
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        `Pixel Agents: Failed to set up bridge — ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

/**
 * Register the setup/remove commands.
 */
export function registerBridgeCommands(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand('pixel-agents.setupKiroBridge', () => {
      if (!workspaceRoot) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }
      try {
        scaffoldBridge(workspaceRoot, context.extensionPath);
        vscode.window.showInformationMessage(
          'Pixel Agents: Kiro bridge set up successfully!',
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Pixel Agents: Setup failed — ${err instanceof Error ? err.message : err}`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pixel-agents.removeKiroBridge', () => {
      if (!workspaceRoot) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
      }
      try {
        removeBridge(workspaceRoot);
        vscode.window.showInformationMessage(
          'Pixel Agents: Kiro bridge removed.',
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Pixel Agents: Removal failed — ${err instanceof Error ? err.message : err}`,
        );
      }
    }),
  );
}
