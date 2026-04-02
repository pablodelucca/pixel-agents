import type * as vscode from 'vscode';

import { HOOK_EVENT_BUFFER_MS } from './constants.js';
import { cancelPermissionTimer, cancelWaitingTimer } from '../../src/timerManager.js';
import type { AgentState } from '../../src/types.js';

/** Normalized hook event received from any provider's hook script via the HTTP server. */
export interface HookEvent {
  /** Hook event name (e.g., 'Stop', 'PermissionRequest', 'Notification') */
  hook_event_name: string;
  /** Claude Code session ID, maps to JSONL filename */
  session_id: string;
  /** Additional provider-specific fields (notification_type, tool_name, etc.) */
  [key: string]: unknown;
}

/** An event waiting to be dispatched once its agent registers. */
interface BufferedEvent {
  providerId: string;
  event: HookEvent;
  timestamp: number;
}

/**
 * Routes hook events from the HTTP server to the correct agent.
 *
 * Maps `session_id` from hook events to internal agent IDs. Events that arrive
 * before their agent is registered are buffered for up to HOOK_EVENT_BUFFER_MS
 * and flushed when the agent registers.
 *
 * When an event is successfully delivered, sets `agent.hookDelivered = true` which
 * suppresses heuristic timers (permission 7s, text-idle 5s) for that agent.
 */
export class HookEventHandler {
  private sessionToAgentId = new Map<string, number>();
  private bufferedEvents: BufferedEvent[] = [];
  private bufferTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private agents: Map<number, AgentState>,
    private waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    private permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    private getWebview: () => vscode.Webview | undefined,
  ) {}

  /** Register an agent for hook event routing. Flushes any buffered events for this session. */
  registerAgent(sessionId: string, agentId: number): void {
    this.sessionToAgentId.set(sessionId, agentId);
    // Flush any buffered events for this session
    this.flushBufferedEvents(sessionId);
  }

  /** Remove an agent's session mapping (called on agent removal/terminal close). */
  unregisterAgent(sessionId: string): void {
    this.sessionToAgentId.delete(sessionId);
  }

  /**
   * Process an incoming hook event. Looks up the agent by session_id,
   * falls back to auto-discovery scan, or buffers if agent not yet registered.
   * @param providerId - Provider that sent the event ('claude', 'codex', etc.)
   * @param event - The hook event payload from the CLI tool
   */
  handleEvent(providerId: string, event: HookEvent): void {
    // providerId is 'claude', 'codex', etc. for future multi-provider routing
    void providerId;
    let agentId = this.sessionToAgentId.get(event.session_id);
    if (agentId === undefined) {
      // Try auto-discovery: scan agents map for matching sessionId
      for (const [id, agent] of this.agents) {
        if (agent.sessionId === event.session_id) {
          this.registerAgent(agent.sessionId, id);
          agentId = id;
          break;
        }
      }
    }
    if (agentId === undefined) {
      // Buffer the event -- agent might not be registered yet
      this.bufferEvent(providerId, event);
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Mark that hooks are working for this agent (suppresses heuristic timers)
    agent.hookDelivered = true;

    const eventName = event.hook_event_name;
    const webview = this.getWebview();

    if (eventName === 'PermissionRequest') {
      this.handlePermissionRequest(agent, agentId, webview);
    } else if (eventName === 'Notification') {
      this.handleNotification(event, agent, agentId, webview);
    } else if (eventName === 'Stop') {
      this.handleStop(agent, agentId, webview);
    }
  }

  /** Handle PermissionRequest: cancel heuristic timer, show permission bubble on agent + sub-agents. */
  private handlePermissionRequest(
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    cancelPermissionTimer(agentId, this.permissionTimers);
    agent.permissionSent = true;
    webview?.postMessage({
      type: 'agentToolPermission',
      id: agentId,
    });
    // Also notify any sub-agents with active tools
    for (const parentToolId of agent.activeSubagentToolNames.keys()) {
      webview?.postMessage({
        type: 'subagentToolPermission',
        id: agentId,
        parentToolId,
      });
    }
  }

  /** Handle Notification: permission_prompt shows bubble, idle_prompt marks agent waiting. */
  private handleNotification(
    event: HookEvent,
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    if (event.notification_type === 'permission_prompt') {
      cancelPermissionTimer(agentId, this.permissionTimers);
      agent.permissionSent = true;
      webview?.postMessage({
        type: 'agentToolPermission',
        id: agentId,
      });
      // Also notify any sub-agents with active non-exempt tools
      for (const parentToolId of agent.activeSubagentToolNames.keys()) {
        webview?.postMessage({
          type: 'subagentToolPermission',
          id: agentId,
          parentToolId,
        });
      }
    } else if (event.notification_type === 'idle_prompt') {
      this.markAgentWaiting(agent, agentId, webview);
    }
  }

  /** Handle Stop: Claude finished responding, mark agent as waiting. */
  private handleStop(
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    this.markAgentWaiting(agent, agentId, webview);
  }

  /**
   * Transition agent to waiting state. Clears foreground tools (preserves background
   * agents), cancels timers, and notifies the webview. Same logic as the turn_duration
   * handler in transcriptParser.ts.
   */
  private markAgentWaiting(
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);

    // Clear foreground tools, preserve background agents (same logic as turn_duration handler)
    const hasForegroundTools = agent.activeToolIds.size > agent.backgroundAgentToolIds.size;
    if (hasForegroundTools) {
      for (const toolId of agent.activeToolIds) {
        if (agent.backgroundAgentToolIds.has(toolId)) continue;
        agent.activeToolIds.delete(toolId);
        agent.activeToolStatuses.delete(toolId);
        const toolName = agent.activeToolNames.get(toolId);
        agent.activeToolNames.delete(toolId);
        if (toolName === 'Task' || toolName === 'Agent') {
          agent.activeSubagentToolIds.delete(toolId);
          agent.activeSubagentToolNames.delete(toolId);
        }
      }
      webview?.postMessage({ type: 'agentToolsClear', id: agentId });
      // Re-send background agent tools
      for (const toolId of agent.backgroundAgentToolIds) {
        const status = agent.activeToolStatuses.get(toolId);
        if (status) {
          webview?.postMessage({
            type: 'agentToolStart',
            id: agentId,
            toolId,
            status,
          });
        }
      }
    } else if (agent.activeToolIds.size > 0 && agent.backgroundAgentToolIds.size === 0) {
      agent.activeToolIds.clear();
      agent.activeToolStatuses.clear();
      agent.activeToolNames.clear();
      agent.activeSubagentToolIds.clear();
      agent.activeSubagentToolNames.clear();
      webview?.postMessage({ type: 'agentToolsClear', id: agentId });
    }

    agent.isWaiting = true;
    agent.permissionSent = false;
    agent.hadToolsInTurn = false;
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'waiting',
    });
  }

  /** Buffer an event for later delivery when the agent registers. */
  private bufferEvent(providerId: string, event: HookEvent): void {
    this.bufferedEvents.push({ providerId, event, timestamp: Date.now() });
    if (!this.bufferTimer) {
      this.bufferTimer = setInterval(() => {
        this.pruneExpiredBufferedEvents();
      }, HOOK_EVENT_BUFFER_MS);
    }
  }

  /** Deliver all buffered events for a session that just registered. */
  private flushBufferedEvents(sessionId: string): void {
    const toFlush = this.bufferedEvents.filter((b) => b.event.session_id === sessionId);
    this.bufferedEvents = this.bufferedEvents.filter((b) => b.event.session_id !== sessionId);
    for (const { providerId, event } of toFlush) {
      this.handleEvent(providerId, event);
    }
    this.cleanupBufferTimer();
  }

  /** Remove buffered events older than HOOK_EVENT_BUFFER_MS. */
  private pruneExpiredBufferedEvents(): void {
    const cutoff = Date.now() - HOOK_EVENT_BUFFER_MS;
    this.bufferedEvents = this.bufferedEvents.filter((b) => b.timestamp > cutoff);
    this.cleanupBufferTimer();
  }

  /** Stop the prune interval when no buffered events remain. */
  private cleanupBufferTimer(): void {
    if (this.bufferedEvents.length === 0 && this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  /** Clean up timers and maps. Called when the extension disposes. */
  dispose(): void {
    if (this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
    this.sessionToAgentId.clear();
    this.bufferedEvents = [];
  }
}
