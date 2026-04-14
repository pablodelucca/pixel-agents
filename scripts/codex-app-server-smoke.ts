import process from 'node:process';

import {
  CodexAppServerClient,
  type CodexJsonRpcNotification,
  type CodexJsonRpcRequest,
} from '../server/src/providers/codex/codexAppServerClient.js';

interface SmokeOptions {
  command?: string;
  args: string[];
  cwd: string;
  prompt?: string;
  timeoutMs: number;
}

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = {
    args: [],
    cwd: process.cwd(),
    timeoutMs: 15_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--command' && next) {
      options.command = next;
      index += 1;
      continue;
    }
    if (arg === '--arg' && next) {
      options.args.push(next);
      index += 1;
      continue;
    }
    if (arg === '--cwd' && next) {
      options.cwd = next;
      index += 1;
      continue;
    }
    if (arg === '--prompt' && next) {
      options.prompt = next;
      index += 1;
      continue;
    }
    if (arg === '--timeout-ms' && next) {
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${options.timeoutMs}`);
  }

  return options;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createServerRequestResponse(request: CodexJsonRpcRequest): Record<string, unknown> {
  if (
    request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'item/fileChange/requestApproval'
  ) {
    return { decision: 'accept' };
  }
  if (request.method === 'item/permissions/requestApproval') {
    return { permissions: {}, scope: 'turn' };
  }
  return {};
}

function describeNotification(notification: CodexJsonRpcNotification): string {
  return JSON.stringify({
    method: notification.method,
    params: notification.params ?? {},
  });
}

function getThreadId(result: Record<string, unknown>): string {
  const thread =
    result.thread && typeof result.thread === 'object' && !Array.isArray(result.thread)
      ? (result.thread as Record<string, unknown>)
      : undefined;
  if (typeof thread?.id === 'string') {
    return thread.id;
  }
  throw new Error('thread/start did not return thread.id');
}

function getTurnId(result: Record<string, unknown>): string | undefined {
  const turn =
    result.turn && typeof result.turn === 'object' && !Array.isArray(result.turn)
      ? (result.turn as Record<string, unknown>)
      : undefined;
  return typeof turn?.id === 'string' ? turn.id : undefined;
}

async function waitForTurnCompletion(
  notifications: CodexJsonRpcNotification[],
  turnId: string | undefined,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const completed = notifications.some((notification) => {
      if (notification.method !== 'turn/completed') return false;
      if (!turnId) return true;
      const turn =
        notification.params?.turn &&
        typeof notification.params.turn === 'object' &&
        !Array.isArray(notification.params.turn)
          ? (notification.params.turn as Record<string, unknown>)
          : undefined;
      return typeof turn?.id === 'string' ? turn.id === turnId : true;
    });
    if (completed) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`turn/completed was not observed for ${turnId ?? 'the active turn'}`);
}

async function waitForNotificationBurst(
  notifications: CodexJsonRpcNotification[],
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (notifications.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const notifications: CodexJsonRpcNotification[] = [];
  const requests: CodexJsonRpcRequest[] = [];

  const client = new CodexAppServerClient({
    command: options.command,
    args: options.args.length > 0 ? options.args : undefined,
    cwd: options.cwd,
    onNotification: (notification) => {
      notifications.push(notification);
      process.stdout.write(`<-- ${describeNotification(notification)}\n`);
    },
    onServerRequest: async (request) => {
      requests.push(request);
      process.stdout.write(`<-- request ${request.method}\n`);
      return createServerRequestResponse(request);
    },
  });

  try {
    await client.start();
    const initializeResult = await withTimeout(
      client.initialize(),
      options.timeoutMs,
      'initialize',
    );
    process.stdout.write(`Initialized Codex app-server: ${JSON.stringify(initializeResult)}\n`);

    const threadResult = await withTimeout(
      client.startThread({ cwd: options.cwd, sessionStartSource: 'startup' }),
      options.timeoutMs,
      'thread/start',
    );
    const threadId = getThreadId(threadResult);
    process.stdout.write(`Started thread ${threadId}\n`);

    if (options.prompt) {
      const turnResult = await withTimeout(
        client.startTurn(threadId, options.prompt, { cwd: options.cwd }),
        options.timeoutMs,
        'turn/start',
      );
      const turnId = getTurnId(turnResult);
      process.stdout.write(`Started turn ${turnId ?? '(unknown id)'}\n`);
      await waitForTurnCompletion(notifications, turnId, options.timeoutMs);
    } else {
      await waitForNotificationBurst(notifications, Math.min(options.timeoutMs, 1_000));
    }

    process.stdout.write(
      `Smoke complete. notifications=${notifications.length} requests=${requests.length}\n`,
    );
  } finally {
    await client.close();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `[codex-app-server-smoke] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
