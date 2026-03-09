import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

export interface AgentHandle {
  /** OS process ID */
  readonly pid: number;
  /** Claude session UUID */
  readonly sessionId: string;
  /** Display name (matches TERMINAL_NAME_PREFIX pattern) */
  readonly name: string;
  /** Working directory the process was spawned in */
  readonly cwd: string;
  /** Underlying child process (for advanced use) */
  readonly process: ChildProcess;
  /** Whether the process has exited */
  readonly exited: boolean;
  /** Send SIGTERM to the process */
  kill(): void;
  /** Register a callback for process exit */
  onExit(callback: (code: number | null) => void): void;
  /** Satisfies the TerminalHandle-like interface expected by AgentState */
  show(): void;
  /** Alias for kill(), matches vscode.Terminal.dispose() */
  dispose(): void;
}

/**
 * Spawn a new `claude` child process with the given session ID and working directory.
 * Returns an AgentHandle wrapping the process.
 */
export function spawnAgent(sessionId: string, cwd: string, name: string): AgentHandle {
  const child = spawn('claude', ['--session-id', sessionId], {
    cwd,
    stdio: 'pipe',
    // Ensure the process is killed when the parent exits
    detached: false,
  });

  if (!child.pid) {
    throw new Error(`Failed to spawn claude process for session ${sessionId}`);
  }

  let hasExited = false;
  const exitCallbacks: Array<(code: number | null) => void> = [];

  child.on('exit', (code) => {
    hasExited = true;
    for (const cb of exitCallbacks) {
      cb(code);
    }
  });

  // Log stderr for debugging
  child.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) {
      console.log(`[Agent ${name}] stderr: ${text}`);
    }
  });

  const handle: AgentHandle = {
    pid: child.pid,
    sessionId,
    name,
    cwd,
    process: child,
    get exited() {
      return hasExited;
    },
    kill() {
      if (!hasExited) {
        child.kill('SIGTERM');
      }
    },
    onExit(callback: (code: number | null) => void) {
      if (hasExited) {
        // Already exited — fire callback immediately
        callback(child.exitCode);
      } else {
        exitCallbacks.push(callback);
      }
    },
    show() {
      // No-op in Electron (no terminal panel to show)
    },
    dispose() {
      handle.kill();
    },
  };

  console.log(`[Agent] Spawned claude process: pid=${child.pid}, session=${sessionId}, cwd=${cwd}`);
  return handle;
}
