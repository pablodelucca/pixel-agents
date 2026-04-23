// server/src/orchestrator/headlessSpawner.ts
import { type ChildProcess,spawn } from 'child_process';
import * as crypto from 'crypto';

import type { HeadlessSpawnResult, Role } from './types.js';

export interface SpawnOptions {
  role: Role;
  task: string;
  cwd: string;
}

export class HeadlessSpawner {
  spawn(opts: SpawnOptions): HeadlessSpawnResult {
    const sessionId = crypto.randomUUID();
    const args = [
      '-p',
      opts.task,
      '--session-id',
      sessionId,
      '--append-system-prompt',
      opts.role.systemPrompt,
      '--permission-mode',
      'bypassPermissions',
    ];
    if (opts.role.allowedTools && opts.role.allowedTools.length > 0) {
      args.push('--allowed-tools', opts.role.allowedTools.join(','));
    }
    const child: ChildProcess = spawn('claude', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    return {
      sessionId,
      process: child,
      roleId: opts.role.id,
      task: opts.task,
      cwd: opts.cwd,
      startedAt: Date.now(),
    };
  }
}
