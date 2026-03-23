import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { getReadableThreadName, getSessionDisplayName } from './sessionDisplayName.js';

const INDEX_POLL_INTERVAL_MS = 1500;
const FILE_POLL_INTERVAL_MS = 1000;
const TOOL_STATUS_MAX_LENGTH = 48;
const RECENT_SESSION_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface SessionIndexEntry {
  id: string;
  thread_name?: string;
}

interface RootSessionState {
  agentId: number;
  threadId: string;
  threadName: string;
  sessionFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSpawnToolIds: Set<string>;
  isActive: boolean;
  isWaiting: boolean;
  taskCompletePending: boolean;
}

interface SubagentSessionState {
  threadId: string;
  parentThreadId: string;
  sessionFile: string;
  fileOffset: number;
  lineBuffer: string;
  label: string;
  parentAgentId: number | null;
  parentToolId: string | null;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  completed: boolean;
}

interface SessionMetaPayload {
  id?: string;
  cwd?: string;
  source?:
    | string
    | {
        subagent?: {
          thread_spawn?: ThreadSpawnMeta;
        };
      };
}

interface ThreadSpawnMeta {
  parent_thread_id?: string;
  agent_nickname?: string;
  agent_role?: string;
}

type MessageSink = (message: Record<string, unknown>) => void;

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function extractSpawnedThreadId(output: string): string | null {
  const parsed = parseJson<{ agent_id?: string }>(output.trim());
  if (parsed?.agent_id) {
    return parsed.agent_id;
  }
  const match = output.match(/"agent_id"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

function formatSpawnLabel(argumentsText: string): string {
  const parsed = parseJson<Record<string, unknown>>(argumentsText);
  const agentType =
    typeof parsed?.agent_type === 'string' && parsed.agent_type !== 'default'
      ? parsed.agent_type
      : null;
  if (agentType) {
    return agentType;
  }
  const message = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
  if (message) {
    return truncate(message.replace(/\s+/g, ' '), TOOL_STATUS_MAX_LENGTH);
  }
  return 'Subagent';
}

function formatToolStatus(toolName: string, argumentsText: string): string {
  const parsed = parseJson<Record<string, unknown>>(argumentsText);

  switch (toolName) {
    case 'shell_command': {
      const command = typeof parsed?.command === 'string' ? parsed.command.trim() : '';
      return command ? `Running: ${truncate(command, TOOL_STATUS_MAX_LENGTH)}` : 'Running command';
    }
    case 'apply_patch':
      return 'Editing files';
    case 'update_plan':
      return 'Planning';
    case 'wait_agent':
      return 'Waiting on subagent';
    case 'send_input':
      return 'Messaging subagent';
    case 'read_thread_terminal':
      return 'Inspecting terminal';
    case 'spawn_agent':
      return `Subtask: ${formatSpawnLabel(argumentsText)}`;
    default:
      return `Using ${toolName}`;
  }
}

export class CodexSessionWatcher {
  private readonly codexRoot = path.join(os.homedir(), '.codex');
  private readonly sessionsRoot = path.join(this.codexRoot, 'sessions');
  private readonly sessionIndexPath = path.join(this.codexRoot, 'session_index.jsonl');
  private readonly hiddenRootThreadIds = new Set<string>();
  private readonly hiddenChildThreadIds = new Set<string>();
  private readonly rootSessions = new Map<string, RootSessionState>();
  private readonly subagentSessions = new Map<string, SubagentSessionState>();
  private readonly filePathByThreadId = new Map<string, string>();
  private readonly childMappingByThreadId = new Map<
    string,
    { parentAgentId: number; parentToolId: string }
  >();
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly indexWatcher = { current: null as fs.FSWatcher | null };
  private readonly indexPollTimer = { current: null as ReturnType<typeof setInterval> | null };
  private nextAgentId = 1;
  private started = false;
  private snapshotPosted = false;

  constructor(
    private readonly workspacePaths: string[],
    private readonly sink: MessageSink,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    console.log(
      `[Pixel Agents] Codex watcher starting for workspaces: ${JSON.stringify(this.workspacePaths)}`,
    );
    await this.syncSessions();
    this.startIndexWatching();
  }

  dispose(): void {
    this.indexWatcher.current?.close();
    this.indexWatcher.current = null;
    if (this.indexPollTimer.current) {
      clearInterval(this.indexPollTimer.current);
      this.indexPollTimer.current = null;
    }
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();
    for (const session of this.rootSessions.values()) {
      try {
        fs.unwatchFile(session.sessionFile);
      } catch {
        /* ignore */
      }
    }
    for (const session of this.subagentSessions.values()) {
      try {
        fs.unwatchFile(session.sessionFile);
      } catch {
        /* ignore */
      }
    }
  }

  postSnapshot(agentMeta: Record<string, unknown> = {}): void {
    const agentIds = [...this.rootSessions.values()]
      .sort((a, b) => a.agentId - b.agentId)
      .map((session) => session.agentId);
    const folderNames: Record<number, string> = {};
    for (const session of this.rootSessions.values()) {
      if (session.threadName) {
        folderNames[session.agentId] = session.threadName;
      }
    }
    this.sink({
      type: 'existingAgents',
      agents: agentIds,
      agentMeta,
      folderNames,
    });

    for (const session of this.rootSessions.values()) {
      this.emitRootSnapshot(session);
    }
    for (const session of this.subagentSessions.values()) {
      this.emitSubagentSnapshot(session);
    }
    this.snapshotPosted = true;
  }

  focusAgent(agentId: number): void {
    const session = [...this.rootSessions.values()].find((item) => item.agentId === agentId);
    if (!session || !fs.existsSync(session.sessionFile)) return;
    this.sink({ type: 'agentSelected', id: agentId });
    void vscode.workspace
      .openTextDocument(session.sessionFile)
      .then((document) => vscode.window.showTextDocument(document, { preview: false }));
  }

  hideAgent(agentId: number): void {
    const session = [...this.rootSessions.values()].find((item) => item.agentId === agentId);
    if (!session) return;

    this.hiddenRootThreadIds.add(session.threadId);
    this.stopWatchingThread(session.threadId, session.sessionFile);
    this.rootSessions.delete(session.threadId);

    for (const [childThreadId, child] of [...this.subagentSessions.entries()]) {
      if (child.parentThreadId === session.threadId) {
        this.hiddenChildThreadIds.add(childThreadId);
        this.stopWatchingThread(childThreadId, child.sessionFile);
        this.subagentSessions.delete(childThreadId);
      }
    }

    this.sink({ type: 'agentClosed', id: agentId });
  }

  openSessionsFolder(): void {
    if (fs.existsSync(this.sessionsRoot)) {
      void vscode.env.openExternal(vscode.Uri.file(this.sessionsRoot));
    }
  }

  private emitRootSnapshot(session: RootSessionState): void {
    for (const toolId of session.activeToolIds) {
      const status = session.activeToolStatuses.get(toolId);
      if (!status) continue;
      this.sink({
        type: 'agentToolStart',
        id: session.agentId,
        toolId,
        status,
      });
    }

    if (session.isWaiting) {
      this.sink({
        type: 'agentStatus',
        id: session.agentId,
        status: 'waiting',
      });
    } else if (session.isActive && session.activeToolIds.size === 0) {
      this.sink({
        type: 'agentStatus',
        id: session.agentId,
        status: 'active',
      });
    }
  }

  private emitSubagentSnapshot(session: SubagentSessionState): void {
    if (session.parentAgentId === null || !session.parentToolId) return;
    for (const [toolId, status] of session.activeToolStatuses) {
      this.sink({
        type: 'subagentToolStart',
        id: session.parentAgentId,
        parentToolId: session.parentToolId,
        toolId,
        status,
      });
    }
  }

  private startIndexWatching(): void {
    if (this.indexPollTimer.current) return;
    try {
      this.indexWatcher.current = fs.watch(this.sessionIndexPath, () => {
        void this.syncSessions();
      });
    } catch {
      /* ignore */
    }

    this.indexPollTimer.current = setInterval(() => {
      void this.syncSessions();
    }, INDEX_POLL_INTERVAL_MS);
  }

  private stopWatchingThread(threadId: string, sessionFile?: string): void {
    this.watchers.get(threadId)?.close();
    this.watchers.delete(threadId);
    const timer = this.pollTimers.get(threadId);
    if (timer) {
      clearInterval(timer);
    }
    this.pollTimers.delete(threadId);
    if (sessionFile) {
      try {
        fs.unwatchFile(sessionFile);
      } catch {
        /* ignore */
      }
    }
  }

  private async syncSessions(): Promise<void> {
    console.log('[Pixel Agents] Syncing Codex sessions');
    const indexEntries = this.readSessionIndexEntries();
    for (const entry of indexEntries.values()) {
      this.tryRegisterSession(entry.id, entry.thread_name);
    }

    for (const session of this.scanRecentSessionFiles()) {
      const threadName = indexEntries.get(session.threadId)?.thread_name;
      this.tryRegisterSession(session.threadId, threadName, session.sessionFile);
    }
  }

  private readSessionIndexEntries(): Map<string, SessionIndexEntry> {
    const entries = new Map<string, SessionIndexEntry>();
    if (!fs.existsSync(this.sessionIndexPath)) return entries;

    const lines = fs.readFileSync(this.sessionIndexPath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = parseJson<SessionIndexEntry>(line);
      if (entry?.id) {
        entries.set(entry.id, entry);
      }
    }

    return entries;
  }

  private tryRegisterSession(
    threadId: string,
    threadName?: string,
    knownSessionFile?: string,
  ): void {
    if (this.rootSessions.has(threadId) || this.subagentSessions.has(threadId)) return;
    if (this.hiddenRootThreadIds.has(threadId) || this.hiddenChildThreadIds.has(threadId)) return;

    const sessionFile = knownSessionFile ?? this.findSessionFile(threadId);
    if (!sessionFile) {
      console.log(`[Pixel Agents] Skipping ${threadId}: session file not found`);
      return;
    }

    const meta = this.readSessionMeta(sessionFile);
    if (!meta) {
      console.log(`[Pixel Agents] Skipping ${threadId}: no session meta in ${sessionFile}`);
      return;
    }

    if (!this.matchesWorkspace(meta.cwd)) {
      console.log(
        `[Pixel Agents] Skipping ${threadId}: cwd ${JSON.stringify(meta.cwd)} does not match workspaces ${JSON.stringify(this.workspacePaths)}`,
      );
      return;
    }

    const source = typeof meta.source === 'string' ? undefined : meta.source;
    const spawnMeta = source?.subagent?.thread_spawn;
    if (spawnMeta?.parent_thread_id) {
      const readableThreadName = getReadableThreadName(threadName);
      const entry: SessionIndexEntry = {
        id: threadId,
        ...(readableThreadName ? { thread_name: readableThreadName } : {}),
      };
      console.log(
        `[Pixel Agents] Registering subagent session ${threadId} from ${sessionFile} with parent ${spawnMeta.parent_thread_id}`,
      );
      this.registerSubagentSession(entry, sessionFile, spawnMeta.parent_thread_id, spawnMeta);
    } else {
      const displayName = getSessionDisplayName(this.workspacePaths, meta.cwd, threadName);
      const entry: SessionIndexEntry = {
        id: threadId,
        ...(displayName ? { thread_name: displayName } : {}),
      };
      console.log(`[Pixel Agents] Registering root session ${threadId} from ${sessionFile}`);
      this.registerRootSession(entry, sessionFile);
    }
  }

  private readSessionMeta(sessionFile: string): SessionMetaPayload | null {
    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const record = parseJson<{ type?: string; payload?: SessionMetaPayload }>(line);
      if (record?.type === 'session_meta' && record.payload) {
        return record.payload;
      }
    }
    return null;
  }

  private matchesWorkspace(sessionCwd?: string): boolean {
    if (!sessionCwd) return false;
    return this.workspacePaths.some((workspacePath) => samePath(workspacePath, sessionCwd));
  }

  private findSessionFile(threadId: string): string | null {
    const cached = this.filePathByThreadId.get(threadId);
    if (cached && fs.existsSync(cached)) {
      return cached;
    }

    const stack = [this.sessionsRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || !fs.existsSync(current)) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) {
          this.filePathByThreadId.set(threadId, fullPath);
          return fullPath;
        }
      }
    }

    return null;
  }

  private scanRecentSessionFiles(): Array<{ threadId: string; sessionFile: string }> {
    const results: Array<{ threadId: string; sessionFile: string }> = [];
    const cutoff = Date.now() - RECENT_SESSION_LOOKBACK_MS;
    const stack = [this.sessionsRoot];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || !fs.existsSync(current)) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

        let stat: fs.Stats;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.mtimeMs < cutoff) continue;

        const meta = this.readSessionMeta(fullPath);
        if (!meta?.id) continue;

        this.filePathByThreadId.set(meta.id, fullPath);
        console.log(`[Pixel Agents] Found recent session file for ${meta.id}: ${fullPath}`);
        results.push({ threadId: meta.id, sessionFile: fullPath });
      }
    }

    return results;
  }

  private registerRootSession(entry: SessionIndexEntry, sessionFile: string): void {
    const session: RootSessionState = {
      agentId: this.nextAgentId++,
      threadId: entry.id,
      threadName: entry.thread_name || '',
      sessionFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSpawnToolIds: new Set(),
      isActive: false,
      isWaiting: false,
      taskCompletePending: false,
    };

    this.rootSessions.set(entry.id, session);
    this.readRootDelta(session, false);
    this.startSessionWatching(entry.id, sessionFile, () => this.readRootDelta(session, true));

    if (this.snapshotPosted) {
      this.sink({
        type: 'agentCreated',
        id: session.agentId,
        ...(session.threadName ? { folderName: session.threadName } : {}),
      });
      this.emitRootSnapshot(session);
    }
  }

  private registerSubagentSession(
    entry: SessionIndexEntry,
    sessionFile: string,
    parentThreadId: string,
    spawnMeta: ThreadSpawnMeta,
  ): void {
    const session: SubagentSessionState = {
      threadId: entry.id,
      parentThreadId,
      sessionFile,
      fileOffset: 0,
      lineBuffer: '',
      label: spawnMeta?.agent_nickname || spawnMeta?.agent_role || entry.thread_name || 'Subagent',
      parentAgentId: null,
      parentToolId: null,
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      completed: false,
    };

    const mapping = this.childMappingByThreadId.get(entry.id);
    if (mapping) {
      session.parentAgentId = mapping.parentAgentId;
      session.parentToolId = mapping.parentToolId;
    }

    this.subagentSessions.set(entry.id, session);
    this.readSubagentDelta(session, false);
    this.startSessionWatching(entry.id, sessionFile, () => this.readSubagentDelta(session, true));

    if (this.snapshotPosted) {
      this.emitSubagentSnapshot(session);
    }
  }

  private startSessionWatching(threadId: string, sessionFile: string, onRead: () => void): void {
    if (this.watchers.has(threadId)) return;

    try {
      const watcher = fs.watch(sessionFile, () => onRead());
      this.watchers.set(threadId, watcher);
    } catch {
      /* ignore */
    }

    try {
      fs.watchFile(sessionFile, { interval: FILE_POLL_INTERVAL_MS }, () => onRead());
    } catch {
      /* ignore */
    }

    const interval = setInterval(onRead, FILE_POLL_INTERVAL_MS);
    this.pollTimers.set(threadId, interval);
  }

  private readRootDelta(session: RootSessionState, emit: boolean): void {
    const lines = this.readNewLines(session.sessionFile, session);
    for (const line of lines) {
      this.processRootLine(session, line, emit);
    }
  }

  private readSubagentDelta(session: SubagentSessionState, emit: boolean): void {
    const lines = this.readNewLines(session.sessionFile, session);
    for (const line of lines) {
      this.processSubagentLine(session, line, emit);
    }
  }

  private readNewLines(
    sessionFile: string,
    state: { fileOffset: number; lineBuffer: string },
  ): string[] {
    try {
      const stat = fs.statSync(sessionFile);
      if (stat.size <= state.fileOffset) return [];

      const buffer = Buffer.alloc(stat.size - state.fileOffset);
      const fd = fs.openSync(sessionFile, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, state.fileOffset);
      fs.closeSync(fd);
      state.fileOffset = stat.size;

      const text = `${state.lineBuffer}${buffer.toString('utf-8')}`;
      const lines = text.split('\n');
      state.lineBuffer = lines.pop() || '';
      return lines.filter((line) => line.trim().length > 0);
    } catch {
      return [];
    }
  }

  private processRootLine(session: RootSessionState, line: string, emit: boolean): void {
    const record = parseJson<{
      type?: string;
      payload?: {
        type?: string;
        name?: string;
        arguments?: string;
        call_id?: string;
        output?: string;
      };
    }>(line);
    if (!record?.type || !record.payload) return;

    if (record.type === 'event_msg') {
      this.processRootEvent(session, record.payload.type, emit);
      return;
    }

    if (record.type !== 'response_item') return;

    if (record.payload.type === 'function_call') {
      const toolId = record.payload.call_id;
      const toolName = record.payload.name;
      if (!toolId || !toolName) return;

      const status = formatToolStatus(toolName, record.payload.arguments || '{}');
      session.taskCompletePending = false;
      session.isActive = true;
      session.isWaiting = false;
      session.activeToolIds.add(toolId);
      session.activeToolNames.set(toolId, toolName);
      session.activeToolStatuses.set(toolId, status);
      if (toolName === 'spawn_agent') {
        session.activeSpawnToolIds.add(toolId);
      }

      if (emit && this.snapshotPosted) {
        this.sink({
          type: 'agentToolStart',
          id: session.agentId,
          toolId,
          status,
        });
      }
      return;
    }

    if (record.payload.type === 'function_call_output') {
      const toolId = record.payload.call_id;
      if (!toolId) return;
      const toolName = session.activeToolNames.get(toolId);
      if (!toolName) return;

      if (toolName === 'spawn_agent') {
        const childThreadId = extractSpawnedThreadId(record.payload.output || '');
        if (childThreadId) {
          this.childMappingByThreadId.set(childThreadId, {
            parentAgentId: session.agentId,
            parentToolId: toolId,
          });
          const child = this.subagentSessions.get(childThreadId);
          if (child) {
            child.parentAgentId = session.agentId;
            child.parentToolId = toolId;
            if (child.completed) {
              if (emit && this.snapshotPosted) {
                this.sink({
                  type: 'subagentClear',
                  id: session.agentId,
                  parentToolId: toolId,
                });
              }
              this.finishRootTool(session, toolId, emit);
            } else if (emit && this.snapshotPosted) {
              this.emitSubagentSnapshot(child);
            }
          }
        }
        return;
      }

      this.finishRootTool(session, toolId, emit);
    }
  }

  private processRootEvent(
    session: RootSessionState,
    eventType: string | undefined,
    emit: boolean,
  ): void {
    if (!eventType) return;

    if (eventType === 'task_started') {
      session.taskCompletePending = false;
      session.isActive = true;
      session.isWaiting = false;
      if (emit && this.snapshotPosted && session.activeToolIds.size === 0) {
        this.sink({
          type: 'agentStatus',
          id: session.agentId,
          status: 'active',
        });
      }
      return;
    }

    if (eventType === 'user_message') {
      session.taskCompletePending = false;
      session.isWaiting = false;
      session.isActive = true;
      return;
    }

    if (eventType === 'task_complete') {
      for (const toolId of [...session.activeToolIds]) {
        if (!session.activeSpawnToolIds.has(toolId)) {
          this.finishRootTool(session, toolId, emit);
        }
      }
      session.taskCompletePending = true;
      if (session.activeToolIds.size === 0) {
        this.markRootWaiting(session, emit);
      }
      return;
    }

    if (eventType === 'turn_aborted') {
      session.taskCompletePending = false;
      for (const toolId of [...session.activeToolIds]) {
        this.finishRootTool(session, toolId, emit);
      }
      this.markRootWaiting(session, emit);
    }
  }

  private processSubagentLine(session: SubagentSessionState, line: string, emit: boolean): void {
    const record = parseJson<{
      type?: string;
      payload?: {
        type?: string;
        name?: string;
        arguments?: string;
        call_id?: string;
      };
    }>(line);
    if (!record?.type || !record.payload) return;

    if (
      record.type === 'event_msg' &&
      (record.payload.type === 'task_complete' || record.payload.type === 'turn_aborted')
    ) {
      session.completed = true;
      session.activeToolStatuses.clear();
      session.activeToolNames.clear();
      if (session.parentAgentId !== null && session.parentToolId) {
        if (emit && this.snapshotPosted) {
          this.sink({
            type: 'subagentClear',
            id: session.parentAgentId,
            parentToolId: session.parentToolId,
          });
        }
        const root = this.rootSessions.get(session.parentThreadId);
        if (root) {
          this.finishRootTool(root, session.parentToolId, emit);
        }
      }
      return;
    }

    if (record.type !== 'response_item') return;

    if (record.payload.type === 'function_call') {
      const toolId = record.payload.call_id;
      const toolName = record.payload.name;
      if (!toolId || !toolName) return;

      const status = formatToolStatus(toolName, record.payload.arguments || '{}');
      session.activeToolStatuses.set(toolId, status);
      session.activeToolNames.set(toolId, toolName);

      if (emit && this.snapshotPosted && session.parentAgentId !== null && session.parentToolId) {
        this.sink({
          type: 'subagentToolStart',
          id: session.parentAgentId,
          parentToolId: session.parentToolId,
          toolId,
          status,
        });
      }
      return;
    }

    if (record.payload.type === 'function_call_output') {
      const toolId = record.payload.call_id;
      if (!toolId) return;
      session.activeToolStatuses.delete(toolId);
      session.activeToolNames.delete(toolId);

      if (emit && this.snapshotPosted && session.parentAgentId !== null && session.parentToolId) {
        this.sink({
          type: 'subagentToolDone',
          id: session.parentAgentId,
          parentToolId: session.parentToolId,
          toolId,
        });
      }
    }
  }

  private finishRootTool(session: RootSessionState, toolId: string, emit: boolean): void {
    if (!session.activeToolIds.has(toolId)) return;
    session.activeToolIds.delete(toolId);
    session.activeToolNames.delete(toolId);
    session.activeToolStatuses.delete(toolId);
    session.activeSpawnToolIds.delete(toolId);

    if (emit && this.snapshotPosted) {
      this.sink({
        type: 'agentToolDone',
        id: session.agentId,
        toolId,
      });
    }

    if (session.taskCompletePending && session.activeToolIds.size === 0) {
      this.markRootWaiting(session, emit);
    }
  }

  private markRootWaiting(session: RootSessionState, emit: boolean): void {
    session.taskCompletePending = false;
    session.isWaiting = true;
    session.isActive = false;

    if (!emit || !this.snapshotPosted) return;

    this.sink({
      type: 'agentToolsClear',
      id: session.agentId,
    });
    this.sink({
      type: 'agentStatus',
      id: session.agentId,
      status: 'waiting',
    });
  }
}
