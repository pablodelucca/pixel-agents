import { execFileSync } from 'child_process';

import type { ProcessStatus, WholesaleAgentId } from './types.js';
import { WHOLESALE_AGENTS } from './types.js';

/** Poll interval for process detection (ms) */
export const PROCESS_POLL_INTERVAL_MS = 10_000;

export type ProcessStatusMap = Record<WholesaleAgentId, ProcessStatus>;

function isProcessRunning(scriptName: string): boolean {
  try {
    const result = execFileSync('pgrep', ['-f', scriptName], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // pgrep returns PIDs if found
    return result.trim().length > 0;
  } catch {
    // pgrep exits with code 1 when no process found
    return false;
  }
}

export function detectProcesses(): ProcessStatusMap {
  const statuses: ProcessStatusMap = {
    1: 'not_running',
    2: 'not_running',
    3: 'not_running',
  };

  for (const agent of Object.values(WHOLESALE_AGENTS)) {
    statuses[agent.id] = isProcessRunning(agent.script) ? 'running' : 'not_running';
  }

  return statuses;
}
