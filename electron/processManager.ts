import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';

import type { AgentHandle } from './agentHandle.js';
import { spawnAgent } from './agentHandle.js';

const TERMINAL_NAME_PREFIX = 'Claude Code';

export interface SpawnResult {
  handle: AgentHandle;
  sessionId: string;
  projectDir: string;
  jsonlFile: string;
}

/**
 * Manages all Claude child processes for the Electron app.
 * Replaces vscode.window.createTerminal / vscode.window.terminals.
 *
 * Agent IDs are provided externally by the AppController (which owns
 * the shared nextAgentIdRef used by ensureProjectScan as well).
 */
export class ProcessManager {
  private handles = new Map<number, AgentHandle>();
  private nextIndex = 1;
  private focusedId: number | null = null;

  /** Callback fired when a process exits */
  onProcessExit: ((id: number) => void) | null = null;

  /**
   * Spawn a new Claude agent process.
   * @param agentId — externally-assigned agent ID (from AppController's nextAgentIdRef)
   * @param cwd — working directory for the Claude process
   */
  spawn(agentId: number, cwd: string): SpawnResult {
    const sessionId = crypto.randomUUID();
    const idx = this.nextIndex++;
    const name = `${TERMINAL_NAME_PREFIX} #${idx}`;

    const handle = spawnAgent(sessionId, cwd, name);

    // Wire up exit handling
    handle.onExit((_code) => {
      console.log(`[ProcessManager] Agent ${agentId} (pid=${handle.pid}) exited`);
      this.handles.delete(agentId);
      if (this.focusedId === agentId) {
        this.focusedId = null;
      }
      this.onProcessExit?.(agentId);
    });

    this.handles.set(agentId, handle);
    this.focusedId = agentId;

    const projectDir = getProjectDirPath(cwd);
    const jsonlFile = path.join(projectDir, `${sessionId}.jsonl`);

    return { handle, sessionId, projectDir, jsonlFile };
  }

  /** Kill a specific agent by ID */
  kill(id: number): void {
    const handle = this.handles.get(id);
    if (handle) {
      handle.kill();
      // The exit handler will clean up the map entry
    }
  }

  /** Get a handle by agent ID */
  getHandle(id: number): AgentHandle | undefined {
    return this.handles.get(id);
  }

  /** Get all active handles */
  getAllHandles(): Map<number, AgentHandle> {
    return this.handles;
  }

  /** Set which agent is "focused" (replaces vscode.window.activeTerminal) */
  focus(id: number): void {
    if (this.handles.has(id)) {
      this.focusedId = id;
    }
  }

  /** Get the currently focused agent handle (replaces vscode.window.activeTerminal) */
  getFocusedHandle(): AgentHandle | null {
    if (this.focusedId !== null) {
      return this.handles.get(this.focusedId) ?? null;
    }
    return null;
  }

  /** Get the focused agent ID */
  getFocusedId(): number | null {
    return this.focusedId;
  }

  /** Advance the terminal name index past restored values */
  advanceIndex(maxIndex: number): void {
    if (maxIndex >= this.nextIndex) {
      this.nextIndex = maxIndex + 1;
    }
  }

  /** Kill all processes (for cleanup on app quit) */
  killAll(): void {
    for (const handle of this.handles.values()) {
      handle.kill();
    }
    this.handles.clear();
    this.focusedId = null;
  }
}

/**
 * Derive the project directory path from a working directory.
 * Matches the VS Code extension's `getProjectDirPath()` logic.
 */
export function getProjectDirPath(cwd: string): string {
  const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', dirName);
}
