import type * as vscode from 'vscode';

import { HOOK_EVENT_BUFFER_MS } from './constants.js';
import type { HookEvent } from './hookServer.js';
import { cancelPermissionTimer, cancelWaitingTimer } from './timerManager.js';
import type { AgentState } from './types.js';

interface BufferedEvent {
  event: HookEvent;
  timestamp: number;
}

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

  registerAgent(sessionId: string, agentId: number): void {
    this.sessionToAgentId.set(sessionId, agentId);
    // Flush any buffered events for this session
    this.flushBufferedEvents(sessionId);
  }

  unregisterAgent(sessionId: string): void {
    this.sessionToAgentId.delete(sessionId);
  }

  handleEvent(event: HookEvent): void {
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
      // Buffer the event — agent might not be registered yet
      this.bufferEvent(event);
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

  private handleStop(
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    this.markAgentWaiting(agent, agentId, webview);
  }

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

  private bufferEvent(event: HookEvent): void {
    this.bufferedEvents.push({ event, timestamp: Date.now() });
    if (!this.bufferTimer) {
      this.bufferTimer = setInterval(() => {
        this.pruneExpiredBufferedEvents();
      }, HOOK_EVENT_BUFFER_MS);
    }
  }

  private flushBufferedEvents(sessionId: string): void {
    const toFlush = this.bufferedEvents.filter((b) => b.event.session_id === sessionId);
    this.bufferedEvents = this.bufferedEvents.filter((b) => b.event.session_id !== sessionId);
    for (const { event } of toFlush) {
      this.handleEvent(event);
    }
    this.cleanupBufferTimer();
  }

  private pruneExpiredBufferedEvents(): void {
    const cutoff = Date.now() - HOOK_EVENT_BUFFER_MS;
    this.bufferedEvents = this.bufferedEvents.filter((b) => b.timestamp > cutoff);
    this.cleanupBufferTimer();
  }

  private cleanupBufferTimer(): void {
    if (this.bufferedEvents.length === 0 && this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  dispose(): void {
    if (this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
    this.sessionToAgentId.clear();
    this.bufferedEvents = [];
  }
}
