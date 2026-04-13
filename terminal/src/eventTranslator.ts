import type { TerminalBridge } from './bridge.js';

const TOOL_DISPLAY_MAX = 30;

/**
 * Minimal port of src/transcriptParser.ts formatToolStatus.
 * Produces the status string shown in character speech bubbles.
 */
function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command.trim() : '';
    const short = cmd.length > TOOL_DISPLAY_MAX ? `${cmd.slice(0, TOOL_DISPLAY_MAX)}\u2026` : cmd;
    return `Running: ${short}`;
  }
  if (toolName === 'Task' || toolName === 'Agent') {
    const desc = typeof input.description === 'string' ? input.description : '';
    const short =
      desc.length > TOOL_DISPLAY_MAX ? `${desc.slice(0, TOOL_DISPLAY_MAX)}\u2026` : desc;
    return desc ? `Subtask: ${short}` : 'Subtask';
  }
  if (toolName === 'Read') {
    const p = typeof input.file_path === 'string' ? (input.file_path.split('/').pop() ?? '') : '';
    return `Reading: ${p}`;
  }
  if (toolName === 'Edit' || toolName === 'Write') {
    const p = typeof input.file_path === 'string' ? (input.file_path.split('/').pop() ?? '') : '';
    return `${toolName === 'Write' ? 'Writing' : 'Editing'}: ${p}`;
  }
  if (toolName === 'Glob') {
    const pattern = typeof input.pattern === 'string' ? input.pattern : '';
    return `Searching: ${pattern}`;
  }
  if (toolName === 'Grep') {
    const pattern = typeof input.pattern === 'string' ? input.pattern : '';
    return `Grep: ${pattern}`;
  }
  return toolName;
}

interface AgentEntry {
  id: number;
  currentHookToolId?: string;
}

/**
 * Translates raw Claude Code hook events (received via PixelAgentsServer) into
 * webview protocol messages (agentCreated, agentToolStart, agentStatus, etc.)
 * and broadcasts them to browser clients via TerminalBridge.
 *
 * This is a simplified, standalone replacement for HookEventHandler that has no
 * VS Code dependencies. It covers the hook-driven subset of events (no JSONL polling).
 */
export class EventTranslator {
  private readonly sessionToAgent = new Map<string, AgentEntry>();
  private nextId = 1;

  constructor(private readonly bridge: TerminalBridge) {}

  handleHookEvent(_providerId: string, event: Record<string, unknown>): void {
    const eventName = event.hook_event_name as string;
    const sessionId = event.session_id as string;

    if (eventName === 'SessionStart') {
      this.ensureAgent(sessionId, /* logReason */ 'SessionStart');
      return;
    }

    const entry = this.ensureAgent(sessionId, eventName);
    const { id } = entry;

    if (eventName === 'PreToolUse') {
      const toolName = (event.tool_name as string | undefined) ?? '';
      const toolInput = (event.tool_input as Record<string, unknown> | undefined) ?? {};
      const status = formatToolStatus(toolName, toolInput);
      const toolId = `hook-${Date.now().toString()}`;
      entry.currentHookToolId = toolId;
      this.bridge.broadcast({ type: 'agentToolStart', id, toolId, status, toolName });
      this.bridge.broadcast({ type: 'agentStatus', id, status: 'active' });
    } else if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') {
      if (entry.currentHookToolId) {
        this.bridge.broadcast({ type: 'agentToolDone', id, toolId: entry.currentHookToolId });
        entry.currentHookToolId = undefined;
      }
    } else if (eventName === 'Stop') {
      entry.currentHookToolId = undefined;
      this.bridge.broadcast({ type: 'agentToolsClear', id });
      this.bridge.broadcast({ type: 'agentStatus', id, status: 'waiting' });
    } else if (
      eventName === 'PermissionRequest' ||
      (eventName === 'Notification' && event.notification_type === 'permission_prompt')
    ) {
      this.bridge.broadcast({ type: 'agentToolPermission', id });
    } else if (eventName === 'Notification' && event.notification_type === 'idle_prompt') {
      this.bridge.broadcast({ type: 'agentStatus', id, status: 'waiting' });
    } else if (eventName === 'SessionEnd') {
      const reason = (event.reason as string | undefined) ?? 'unknown';
      // /clear and /resume are followed immediately by a new SessionStart — keep the agent alive
      if (reason !== 'clear' && reason !== 'resume') {
        this.bridge.broadcast({ type: 'agentClosed', id });
        this.sessionToAgent.delete(sessionId);
        console.log(`[pixel-agents-terminal] Agent ${id.toString()} closed (reason: ${reason})`);
      }
    }
  }

  /**
   * Returns the agent entry for a session, creating one (and broadcasting agentCreated)
   * if it does not yet exist. Handles the race where hook events arrive before SessionStart.
   */
  private ensureAgent(sessionId: string, reason: string): AgentEntry {
    const existing = this.sessionToAgent.get(sessionId);
    if (existing) return existing;

    const id = this.nextId++;
    const entry: AgentEntry = { id };
    this.sessionToAgent.set(sessionId, entry);
    this.bridge.broadcast({ type: 'agentCreated', id });
    console.log(
      `[pixel-agents-terminal] Agent ${id.toString()} created via ${reason} (session ${sessionId.slice(0, 8)}...)`,
    );
    return entry;
  }
}
