import * as path from 'path';
import * as vscode from 'vscode';

import type {
  Event,
  IAgentHandle,
  IAgentProvider,
  IDisposable,
  PersistedAgentHandle,
  SpawnAgentOptions,
} from '../plugin/types.js';

const TERMINAL_NAME_PREFIX = 'Claude Code';

class VSCodeAgentHandle implements IAgentHandle {
  constructor(
    public readonly id: number,
    public readonly sessionId: string,
    public readonly workspacePath: string,
    public readonly displayName: string,
    private readonly terminal: vscode.Terminal,
    private readonly terminalName: string,
  ) {}

  focus(): void {
    this.terminal.show();
  }

  close(): void {
    this.terminal.dispose();
  }

  serialize(): PersistedAgentHandle {
    return {
      id: this.id,
      sessionId: this.sessionId,
      workspacePath: this.workspacePath,
      displayName: this.displayName,
      terminalName: this.terminalName,
    };
  }

  matchesTerminal(terminal: vscode.Terminal): boolean {
    return this.terminal === terminal;
  }
}

export class VSCodeAgentProvider implements IAgentProvider {
  private nextTerminalIndex = 1;
  private handles = new Map<number, VSCodeAgentHandle>();
  private closedHandlers: ((id: number) => void)[] = [];
  private focusedHandlers: ((id: number | null) => void)[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [, handle] of this.handles) {
          if (handle.matchesTerminal(terminal)) {
            this.handles.delete(handle.id);
            for (const handler of this.closedHandlers) {
              handler(handle.id);
            }
            break;
          }
        }
      }),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        if (!terminal) {
          for (const handler of this.focusedHandlers) handler(null);
          return;
        }
        for (const [, handle] of this.handles) {
          if (handle.matchesTerminal(terminal)) {
            for (const handler of this.focusedHandlers) handler(handle.id);
            return;
          }
        }
        for (const handler of this.focusedHandlers) handler(null);
      }),
    );
  }

  async spawnAgent(options: SpawnAgentOptions): Promise<IAgentHandle> {
    const idx = this.nextTerminalIndex++;
    const terminalName = `${TERMINAL_NAME_PREFIX} #${idx}`;
    const terminal = vscode.window.createTerminal({
      name: terminalName,
      cwd: options.workspacePath,
    });
    terminal.show();
    terminal.sendText(`claude --session-id ${options.sessionId}`);

    const handle = new VSCodeAgentHandle(
      options.id,
      options.sessionId,
      options.workspacePath,
      terminalName,
      terminal,
      terminalName,
    );
    this.handles.set(options.id, handle);
    return handle;
  }

  async restoreAgents(persisted: PersistedAgentHandle[]): Promise<IAgentHandle[]> {
    const liveTerminals = vscode.window.terminals;
    const restored: IAgentHandle[] = [];
    let maxIdx = 0;

    for (const p of persisted) {
      const terminalName = p.terminalName as string | undefined;
      if (!terminalName) continue;
      const terminal = liveTerminals.find((t) => t.name === terminalName);
      if (!terminal) continue;

      const match = terminalName.match(/#(\d+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx > maxIdx) maxIdx = idx;
      }

      const handle = new VSCodeAgentHandle(
        p.id,
        p.sessionId,
        p.workspacePath,
        p.displayName,
        terminal,
        terminalName,
      );
      this.handles.set(p.id, handle);
      restored.push(handle);
    }

    if (maxIdx >= this.nextTerminalIndex) {
      this.nextTerminalIndex = maxIdx + 1;
    }

    return restored;
  }

  adoptForFile(file: string, projectDir: string, id: number): IAgentHandle | null {
    const activeTerminal = vscode.window.activeTerminal;
    if (!activeTerminal) return null;

    // Don't adopt terminals already owned by this provider
    for (const [, handle] of this.handles) {
      if (handle.matchesTerminal(activeTerminal)) return null;
    }

    const terminalName = activeTerminal.name;
    // reverse projectDir derivation is not reliable; best effort
    const workspacePath = path.dirname(path.dirname(projectDir));
    const sessionId = path.basename(file, '.jsonl');
    const handle = new VSCodeAgentHandle(
      id,
      sessionId,
      workspacePath,
      terminalName,
      activeTerminal,
      terminalName,
    );
    this.handles.set(id, handle);
    console.log(
      `[Pixel Agents] Agent ${id}: adopted terminal "${terminalName}" for ${path.basename(file)}`,
    );
    return handle;
  }

  onAgentFocused: Event<number | null> = (handler): IDisposable => {
    this.focusedHandlers.push(handler);
    return {
      dispose: () => {
        this.focusedHandlers = this.focusedHandlers.filter((h) => h !== handler);
      },
    };
  };

  onAgentClosed: Event<number> = (handler): IDisposable => {
    this.closedHandlers.push(handler);
    return {
      dispose: () => {
        this.closedHandlers = this.closedHandlers.filter((h) => h !== handler);
      },
    };
  };

  dispose(): void {
    this.closedHandlers = [];
    this.focusedHandlers = [];
    this.handles.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
