import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodexAppServerClient } from '../src/providers/codex/codexAppServerClient.js';

class FakeCodexProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);
}

function createJsonMessageCollector(stream: PassThrough) {
  const lines: Record<string, unknown>[] = [];
  let buffer = '';

  stream.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      if (!part.trim()) continue;
      lines.push(JSON.parse(part) as Record<string, unknown>);
    }
  });

  return {
    async nextWhere(
      predicate: (message: Record<string, unknown>) => boolean,
      timeoutMs = 2_000,
    ): Promise<Record<string, unknown>> {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const index = lines.findIndex(predicate);
        if (index >= 0) {
          return lines.splice(index, 1)[0];
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Timed out waiting for JSON message');
    },
  };
}

describe('CodexAppServerClient', () => {
  let fakeProcess: FakeCodexProcess;
  let writtenMessages: ReturnType<typeof createJsonMessageCollector>;

  beforeEach(() => {
    fakeProcess = new FakeCodexProcess();
    writtenMessages = createJsonMessageCollector(fakeProcess.stdin);
  });

  it('initializes, buffers notifications, and auto-responds to approval requests', async () => {
    const onServerRequest = vi.fn().mockResolvedValue({ decision: 'accept' });
    const client = new CodexAppServerClient({
      spawnProcess: () => fakeProcess,
      onServerRequest,
    });

    await client.start();

    const initializePromise = client.initialize({
      clientInfo: {
        name: 'pixel-agents-test',
        title: 'Pixel Agents Test',
        version: '1.0.0',
      },
    });

    const initializeRequest = await writtenMessages.nextWhere(
      (message) => message.method === 'initialize',
    );
    fakeProcess.stdout.write(
      `${JSON.stringify({
        id: initializeRequest.id,
        result: {
          userAgent: 'pixel-agents-test',
          codexHome: '/tmp/.codex',
          platformFamily: 'unix',
          platformOs: 'linux',
        },
      })}\n`,
    );

    const initializeResult = await initializePromise;
    expect(initializeResult.codexHome).toBe('/tmp/.codex');

    const initializedNotification = await writtenMessages.nextWhere(
      (message) => message.method === 'initialized',
    );
    expect(initializedNotification).toMatchObject({ method: 'initialized' });

    fakeProcess.stdout.write(
      `${JSON.stringify({
        method: 'thread/started',
        params: { thread: { id: 'thr_1' } },
      })}\n`,
    );
    fakeProcess.stdout.write(
      `${JSON.stringify({
        method: 'item/commandExecution/requestApproval',
        id: 'approval-1',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          itemId: 'cmd_1',
          command: 'npm run lint',
        },
      })}\n`,
    );
    fakeProcess.stdout.write(
      `${JSON.stringify({
        method: 'turn/completed',
        params: { turn: { id: 'turn_1', status: 'completed' } },
      })}\n`,
    );

    expect(await client.nextNotification()).toMatchObject({
      method: 'thread/started',
      params: { thread: { id: 'thr_1' } },
    });
    expect(await client.nextNotification()).toMatchObject({
      method: 'turn/completed',
      params: { turn: { id: 'turn_1', status: 'completed' } },
    });

    expect(onServerRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'thr_1',
          turnId: 'turn_1',
          itemId: 'cmd_1',
          command: 'npm run lint',
        },
      }),
    );

    const approvalResponse = await writtenMessages.nextWhere(
      (message) => message.id === 'approval-1',
    );
    expect(approvalResponse).toMatchObject({
      id: 'approval-1',
      result: { decision: 'accept' },
    });

    await client.close();
  });
});
