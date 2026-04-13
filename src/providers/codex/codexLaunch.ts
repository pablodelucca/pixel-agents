import * as readline from 'readline';

import {
  CodexAppServerClient,
  type CodexJsonRpcNotification,
  type CodexJsonRpcRequest,
} from '../../../server/src/providers/codex/codexAppServerClient.js';

interface LaunchContext {
  sessionId: string;
  cwd: string;
  serverPort: string;
  serverToken: string;
  bypassPermissions: boolean;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function getLaunchContext(): LaunchContext {
  return {
    sessionId: getRequiredEnv('PIXEL_AGENTS_SESSION_ID'),
    cwd: getRequiredEnv('PIXEL_AGENTS_CWD'),
    serverPort: getRequiredEnv('PIXEL_AGENTS_SERVER_PORT'),
    serverToken: getRequiredEnv('PIXEL_AGENTS_SERVER_TOKEN'),
    bypassPermissions: process.env['PIXEL_AGENTS_BYPASS_PERMISSIONS'] === '1',
  };
}

async function postCodexEvent(
  context: LaunchContext,
  message: CodexJsonRpcNotification | CodexJsonRpcRequest,
): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${context.serverPort}/api/hooks/codex`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.serverToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: context.sessionId,
      hook_event_name: 'CodexEvent',
      method: message.method,
      params: message.params ?? {},
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Pixel Agents server rejected Codex event ${message.method}: ${response.status}`,
    );
  }
}

function createApprovalResponse(
  request: CodexJsonRpcRequest,
  context: LaunchContext,
): Record<string, unknown> {
  if (
    request.method === 'item/commandExecution/requestApproval' ||
    request.method === 'item/fileChange/requestApproval'
  ) {
    return { decision: 'accept' };
  }

  if (request.method === 'item/permissions/requestApproval') {
    const requestedPermissions =
      request.params && typeof request.params.permissions === 'object' && request.params.permissions
        ? (request.params.permissions as Record<string, unknown>)
        : {};

    return {
      permissions: context.bypassPermissions ? requestedPermissions : requestedPermissions,
      scope: 'turn',
    };
  }

  return {};
}

function getThreadId(result: Record<string, unknown>, fallbackId: string): string {
  const thread =
    result.thread && typeof result.thread === 'object' && !Array.isArray(result.thread)
      ? (result.thread as Record<string, unknown>)
      : undefined;
  return typeof thread?.id === 'string' ? thread.id : fallbackId;
}

function getTurnId(result: Record<string, unknown>): string | undefined {
  const turn =
    result.turn && typeof result.turn === 'object' && !Array.isArray(result.turn)
      ? (result.turn as Record<string, unknown>)
      : undefined;
  return typeof turn?.id === 'string' ? turn.id : undefined;
}

function extractDeltaText(notification: CodexJsonRpcNotification): string {
  const params = notification.params;
  if (!params) return '';

  if (typeof params.delta === 'string') {
    return params.delta;
  }

  if (params.delta && typeof params.delta === 'object' && !Array.isArray(params.delta)) {
    const delta = params.delta as Record<string, unknown>;
    if (typeof delta.text === 'string') {
      return delta.text;
    }
  }

  if (typeof params.text === 'string') {
    return params.text;
  }

  return '';
}

function isTurnCompleted(
  notification: CodexJsonRpcNotification,
  turnId: string | undefined,
): boolean {
  if (notification.method !== 'turn/completed') return false;
  if (!turnId) return true;

  const turn =
    notification.params?.turn &&
    typeof notification.params.turn === 'object' &&
    !Array.isArray(notification.params.turn)
      ? (notification.params.turn as Record<string, unknown>)
      : undefined;

  return typeof turn?.id === 'string' ? turn.id === turnId : true;
}

async function streamTurn(client: CodexAppServerClient, turnId: string | undefined): Promise<void> {
  let wroteDelta = false;

  while (true) {
    const notification = await client.nextNotification();
    const deltaText = extractDeltaText(notification);
    if (deltaText) {
      process.stdout.write(deltaText);
      wroteDelta = true;
    }

    if (isTurnCompleted(notification, turnId)) {
      if (wroteDelta) {
        process.stdout.write('\n');
      }
      return;
    }
  }
}

async function main(): Promise<void> {
  const context = getLaunchContext();
  const client = new CodexAppServerClient({
    cwd: context.cwd,
    onNotification: (notification) => {
      void postCodexEvent(context, notification).catch((error) => {
        process.stderr.write(
          `[Pixel Agents] Failed to forward Codex notification ${notification.method}: ${String(error)}\n`,
        );
      });
    },
    onServerRequest: async (request) => {
      await postCodexEvent(context, request);
      return createApprovalResponse(request, context);
    },
  });

  await client.start();
  await client.initialize({
    clientInfo: {
      name: 'pixel_agents_codex',
      title: 'Pixel Agents Codex Launcher',
      version: '1.0.0',
    },
  });

  const threadStart = await client.startThread({
    cwd: context.cwd,
    sessionStartSource: 'startup',
  });
  const threadId = getThreadId(threadStart, context.sessionId);

  process.stdout.write(`Pixel Agents Codex ready (${threadId})\n`);
  process.stdout.write('Type /exit to close the session.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let turnInFlight = false;
  rl.setPrompt('codex> ');
  rl.prompt();

  rl.on('line', (rawLine) => {
    void (async () => {
      const line = rawLine.trim();
      if (!line) {
        rl.prompt();
        return;
      }
      if (line === '/exit') {
        rl.close();
        return;
      }
      if (turnInFlight) {
        process.stdout.write('A Codex turn is already in progress.\n');
        rl.prompt();
        return;
      }

      turnInFlight = true;
      try {
        const turnStart = await client.startTurn(threadId, line, {
          cwd: context.cwd,
        });
        await streamTurn(client, getTurnId(turnStart));
      } catch (error) {
        process.stderr.write(`[Pixel Agents] Codex turn failed: ${String(error)}\n`);
      } finally {
        turnInFlight = false;
        rl.prompt();
      }
    })();
  });

  rl.on('close', () => {
    void client.close().finally(() => {
      process.exit(0);
    });
  });
}

void main().catch((error) => {
  process.stderr.write(`[Pixel Agents] Codex launch failed: ${String(error)}\n`);
  process.exit(1);
});
