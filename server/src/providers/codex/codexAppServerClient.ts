import { spawn } from 'child_process';
import { createInterface, type Interface as ReadLineInterface } from 'readline';

type Awaitable<T> = Promise<T> | T;

export interface CodexJsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

export interface CodexJsonRpcRequest extends CodexJsonRpcNotification {
  id: string | number;
}

export interface CodexJsonRpcResponse {
  id: string | number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface CodexAppServerProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr?: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals | number): boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface CodexInitializeParams {
  clientInfo?: {
    name: string;
    title: string;
    version: string;
  };
  capabilities?: Record<string, unknown>;
}

export interface CodexAppServerClientOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnProcess?: () => CodexAppServerProcess;
  onNotification?: (notification: CodexJsonRpcNotification) => void;
  onServerRequest?: (request: CodexJsonRpcRequest) => Awaitable<Record<string, unknown> | void>;
}

const DEFAULT_COMMAND = process.platform === 'win32' ? 'codex.cmd' : 'codex';
const DEFAULT_ARGS = ['app-server', '--listen', 'stdio://'];

export class CodexAppServerClient {
  private processRef: CodexAppServerProcess | null = null;
  private stdoutReader: ReadLineInterface | null = null;
  private stderrReader: ReadLineInterface | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<string, PendingRequest>();
  private notificationQueue: CodexJsonRpcNotification[] = [];
  private notificationWaiters: Array<(notification: CodexJsonRpcNotification) => void> = [];

  constructor(private readonly options: CodexAppServerClientOptions = {}) {}

  async start(): Promise<void> {
    if (this.processRef) return;

    this.processRef = this.options.spawnProcess
      ? this.options.spawnProcess()
      : spawn(this.options.command ?? DEFAULT_COMMAND, this.options.args ?? DEFAULT_ARGS, {
          cwd: this.options.cwd,
          env: this.options.env,
          shell: process.platform === 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

    this.stdoutReader = createInterface({ input: this.processRef.stdout });
    this.stdoutReader.on('line', (line) => {
      void this.handleLine(line);
    });

    if (this.processRef.stderr) {
      this.stderrReader = createInterface({ input: this.processRef.stderr });
      this.stderrReader.on('line', () => {
        // The launch script owns stderr presentation. Keeping the stream drained
        // prevents child-process backpressure without coupling tests to logging.
      });
    }
  }

  async close(): Promise<void> {
    this.stdoutReader?.close();
    this.stderrReader?.close();
    this.stdoutReader = null;
    this.stderrReader = null;

    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Codex app-server transport closed'));
    }
    this.pendingRequests.clear();
    this.notificationQueue = [];
    this.notificationWaiters = [];

    if (this.processRef) {
      this.processRef.kill();
      this.processRef = null;
    }
  }

  async initialize(params: CodexInitializeParams = {}): Promise<Record<string, unknown>> {
    const result = await this.request('initialize', {
      clientInfo: params.clientInfo ?? {
        name: 'pixel-agents',
        title: 'Pixel Agents',
        version: '0.0.0',
      },
      capabilities: {
        experimentalApi: true,
        ...(params.capabilities ?? {}),
      },
    });
    await this.notify('initialized', {});
    return this.expectObject(result, 'initialize');
  }

  async startThread(params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.expectObject(await this.request('thread/start', params), 'thread/start');
  }

  async startTurn(
    threadId: string,
    input: string | Record<string, unknown> | Array<Record<string, unknown>>,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return this.expectObject(
      await this.request('turn/start', {
        ...params,
        threadId,
        input: this.normalizeInput(input),
      }),
      'turn/start',
    );
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const requestId = String(this.nextRequestId++);
    const request = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
    });
    this.writeMessage({
      id: requestId,
      method,
      params,
    });
    return request;
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    this.writeMessage({
      method,
      params,
    });
  }

  async nextNotification(): Promise<CodexJsonRpcNotification> {
    if (this.notificationQueue.length > 0) {
      return this.notificationQueue.shift()!;
    }
    return new Promise((resolve) => {
      this.notificationWaiters.push(resolve);
    });
  }

  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      for (const pending of this.pendingRequests.values()) {
        pending.reject(
          new Error(
            `Failed to parse Codex app-server JSON-RPC line: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      this.pendingRequests.clear();
      return;
    }

    const method = typeof message.method === 'string' ? message.method : undefined;
    const id = message.id;

    if (method && id !== undefined) {
      await this.handleServerRequest({
        id: id as string | number,
        method,
        params: this.asObject(message.params),
      });
      return;
    }

    if (method) {
      this.enqueueNotification({
        method,
        params: this.asObject(message.params),
      });
      return;
    }

    if (id === undefined) return;

    const pending = this.pendingRequests.get(String(id));
    if (!pending) return;
    this.pendingRequests.delete(String(id));

    const error = this.asObject(message.error);
    if (error) {
      pending.reject(
        new Error(
          (typeof error.message === 'string' ? error.message : undefined) ||
            `Codex app-server request ${String(id)} failed`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private async handleServerRequest(request: CodexJsonRpcRequest): Promise<void> {
    const response =
      (await this.options.onServerRequest?.(request)) ??
      this.defaultServerRequestResponse(request.method);

    this.writeMessage({
      id: request.id,
      result: response,
    });
  }

  private enqueueNotification(notification: CodexJsonRpcNotification): void {
    this.options.onNotification?.(notification);
    const waiter = this.notificationWaiters.shift();
    if (waiter) {
      waiter(notification);
      return;
    }
    this.notificationQueue.push(notification);
  }

  private defaultServerRequestResponse(method: string): Record<string, unknown> {
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval'
    ) {
      return { decision: 'accept' };
    }
    if (method === 'item/permissions/requestApproval') {
      return { permissions: {}, scope: 'turn' };
    }
    return {};
  }

  private writeMessage(payload: Record<string, unknown>): void {
    if (!this.processRef) {
      throw new Error('Codex app-server transport has not been started');
    }
    this.processRef.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private expectObject(value: unknown, method: string): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new Error(`Codex app-server ${method} response must be an object`);
  }

  private asObject(value: unknown): Record<string, unknown> | undefined {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }

  private normalizeInput(
    input: string | Record<string, unknown> | Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    if (typeof input === 'string') {
      return [{ type: 'text', text: input }];
    }
    return Array.isArray(input) ? input : [input];
  }
}
