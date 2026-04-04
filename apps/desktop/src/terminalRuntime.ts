import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn as spawnChild, type ChildProcess } from 'node:child_process';

import { spawn as spawnPty, type IPty } from 'node-pty';

export interface SessionConfig {
  agentId: number;
  sessionId: string;
  cwd: string;
  command: string;
}

interface Disposable {
  dispose(): void;
}

interface RuntimeExit {
  exitCode: number;
  signal?: string;
}

export interface RuntimeProcess {
  onData(listener: (chunk: string) => void): Disposable;
  onExit(listener: (event: RuntimeExit) => void): Disposable;
  write(input: string): void;
  kill(): void;
}

export interface AgentHandle {
  agentId: number;
  sessionId: string;
  cwd: string;
  command: string;
  process: RuntimeProcess;
  backend: 'node-pty' | 'child_process';
}

export interface TerminalRuntime {
  spawn(sessionConfig: SessionConfig): AgentHandle;
  focus(agentId: number): void;
  dispose(agentId: number): void;
  disposeAll(): void;
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function resolveUnixShellBinary(): string {
  const candidates: string[] = [];
  const fromEnv = process.env.SHELL?.trim();
  if (fromEnv) {
    candidates.push(fromEnv.split(/\s+/)[0]);
  }
  candidates.push('/bin/zsh', '/bin/bash', '/bin/sh');

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '/bin/sh';
}

function resolveScriptBinary(): string | null {
  if (process.platform === 'win32') {
    return null;
  }

  const candidates = ['/usr/bin/script', '/bin/script'];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function resolveUnixScriptInvocation(
  shell: string,
  command: string,
): { command: string; args: string[] } | null {
  const scriptBinary = resolveScriptBinary();
  if (!scriptBinary) {
    return null;
  }

  if (process.platform === 'darwin') {
    return {
      command: scriptBinary,
      args: ['-q', '/dev/null', shell, '-ilc', command],
    };
  }

  const wrapped = `${quoteForShell(shell)} -ilc ${quoteForShell(command)}`;
  return {
    command: scriptBinary,
    args: ['-q', '-e', '-c', wrapped, '/dev/null'],
  };
}

function findNvmBinDirs(): string[] {
  try {
    const root = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (!fs.existsSync(root)) return [];

    const versionDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

    const result: string[] = [];
    for (const versionDir of versionDirs) {
      const binDir = path.join(root, versionDir, 'bin');
      if (fs.existsSync(binDir)) {
        result.push(binDir);
      }
    }
    return result;
  } catch {
    return [];
  }
}

function buildPathEnv(existing: string | undefined, extraEntries: string[]): string {
  const unique = new Set<string>();
  for (const rawEntry of (existing ?? '').split(':')) {
    const entry = rawEntry.trim();
    if (entry) unique.add(entry);
  }
  for (const rawEntry of extraEntries) {
    const entry = rawEntry.trim();
    if (entry) unique.add(entry);
  }
  return [...unique].join(':');
}

function buildEnv(): Record<string, string> {
  const env = sanitizeEnv(process.env);
  delete env.npm_config_prefix;
  delete env.NPM_CONFIG_PREFIX;
  if (process.platform !== 'win32') {
    const home = os.homedir();
    const extraPathEntries = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      path.join(home, '.volta', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, 'bin'),
      ...findNvmBinDirs(),
    ];
    env.PATH = buildPathEnv(env.PATH, extraPathEntries);
    if (!env.TERM || env.TERM === 'dumb') {
      env.TERM = 'xterm-256color';
    }
  }
  return env;
}

function wrapPtyProcess(ptyProcess: IPty): RuntimeProcess {
  return {
    onData(listener: (chunk: string) => void): Disposable {
      const disposable = ptyProcess.onData(listener);
      return { dispose: () => disposable.dispose() };
    },
    onExit(listener: (event: RuntimeExit) => void): Disposable {
      const disposable = ptyProcess.onExit((event) => {
        listener({
          exitCode: event.exitCode,
          signal: event.signal ? String(event.signal) : undefined,
        });
      });
      return { dispose: () => disposable.dispose() };
    },
    write(input: string): void {
      ptyProcess.write(input);
    },
    kill(): void {
      ptyProcess.kill();
    },
  };
}

function createChildProcess(
  command: string,
  cwd: string,
  env: Record<string, string>,
): ChildProcess {
  if (process.platform === 'win32') {
    return spawnChild('powershell.exe', ['-NoLogo', '-NoExit', '-Command', command], {
      cwd,
      env,
      stdio: 'pipe',
    });
  }

  const shell = resolveUnixShellBinary();
  const scriptInvocation = resolveUnixScriptInvocation(shell, command);
  if (scriptInvocation) {
    return spawnChild(scriptInvocation.command, scriptInvocation.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  return spawnChild(shell, ['-ilc', command], {
    cwd,
    env,
    stdio: 'pipe',
  });
}

function wrapChildProcess(child: ChildProcess): RuntimeProcess {
  return {
    onData(listener: (chunk: string) => void): Disposable {
      const onStdout = (buf: Buffer) => listener(buf.toString('utf-8'));
      const onStderr = (buf: Buffer) => listener(buf.toString('utf-8'));
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      return {
        dispose(): void {
          child.stdout?.off('data', onStdout);
          child.stderr?.off('data', onStderr);
        },
      };
    },
    onExit(listener: (event: RuntimeExit) => void): Disposable {
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
        listener({
          exitCode: code ?? 0,
          signal: signal ?? undefined,
        });
      };
      child.on('close', onClose);
      return {
        dispose(): void {
          child.off('close', onClose);
        },
      };
    },
    write(input: string): void {
      if (!child.stdin || !child.stdin.writable) return;
      child.stdin.write(input);
    },
    kill(): void {
      try {
        child.kill();
      } catch {
        // no-op
      }
    },
  };
}

export class PtyTerminalRuntime implements TerminalRuntime {
  private readonly handles = new Map<number, AgentHandle>();

  spawn(sessionConfig: SessionConfig): AgentHandle {
    const env = buildEnv();
    let handle: AgentHandle | null = null;
    let lastError: unknown;

    try {
      const shell = process.platform === 'win32' ? 'powershell.exe' : resolveUnixShellBinary();
      const args =
        process.platform === 'win32'
          ? ['-NoLogo', '-NoExit', '-Command', sessionConfig.command]
          : ['-ilc', sessionConfig.command];
      const ptyProcess = spawnPty(shell, args, {
        cwd: sessionConfig.cwd,
        env,
        name: 'xterm-color',
        cols: 120,
        rows: 30,
      });
      handle = {
        ...sessionConfig,
        process: wrapPtyProcess(ptyProcess),
        backend: 'node-pty',
      };
    } catch (error) {
      lastError = error;
    }

    if (!handle) {
      try {
        const child = createChildProcess(sessionConfig.command, sessionConfig.cwd, env);
        handle = {
          ...sessionConfig,
          process: wrapChildProcess(child),
          backend: 'child_process',
        };
      } catch (fallbackError) {
        const primary = lastError instanceof Error ? lastError.message : String(lastError);
        const fallback =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`node-pty: ${primary} | child_process: ${fallback}`);
      }
    }

    this.handles.set(sessionConfig.agentId, handle);
    return handle;
  }

  focus(agentId: number): void {
    const handle = this.handles.get(agentId);
    if (!handle) return;
    handle.process.write('\u000c');
  }

  dispose(agentId: number): void {
    const handle = this.handles.get(agentId);
    if (!handle) return;
    handle.process.kill();
    this.handles.delete(agentId);
  }

  disposeAll(): void {
    for (const agentId of this.handles.keys()) {
      this.dispose(agentId);
    }
  }
}
