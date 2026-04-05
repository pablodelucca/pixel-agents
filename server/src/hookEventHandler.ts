// TODO(Standalone version): Replace vscode.Webview with MessageSender interface from core/src/messages.ts
// TODO(Standalone version): Move timerManager and types to server/src/ to eliminate cross-boundary imports
import * as path from 'path';
import type * as vscode from 'vscode';

import { cancelPermissionTimer, cancelWaitingTimer } from '../../src/timerManager.js';
import type { AgentState } from '../../src/types.js';
import { HOOK_EVENT_BUFFER_MS } from './constants.js';

const debug = process.env.PIXEL_AGENTS_DEBUG === '1';

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
/** Callback for session lifecycle events detected via hooks. */
export interface SessionLifecycleCallbacks {
  /** Called when an external session is detected (unknown session_id in SessionStart). */
  onExternalSessionDetected?: (sessionId: string, transcriptPath: string, cwd: string) => void;
  /** Called when /clear is detected via hooks (SessionEnd reason=clear + SessionStart source=clear). */
  onSessionClear?: (agentId: number, newSessionId: string, newTranscriptPath: string) => void;
  /** Called when a session ends (exit/logout). */
  onSessionEnd?: (agentId: number, reason: string) => void;
}

export class HookEventHandler {
  private sessionToAgentId = new Map<string, number>();
  private bufferedEvents: BufferedEvent[] = [];
  private bufferTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleCallbacks: SessionLifecycleCallbacks = {};

  constructor(
    private agents: Map<number, AgentState>,
    private waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    private permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    private getWebview: () => vscode.Webview | undefined,
  ) {}

  /** Set callbacks for session lifecycle events (SessionStart/SessionEnd). */
  setLifecycleCallbacks(callbacks: SessionLifecycleCallbacks): void {
    this.lifecycleCallbacks = callbacks;
  }

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
  handleEvent(_providerId: string, event: HookEvent): void {
    const eventName = event.hook_event_name;

    // --- SessionStart: handle /clear for known agents, ignore unknown sessions ---
    // External session detection via SessionStart is deferred to Phase C.
    // For now, only use SessionStart for:
    //   1. Confirming known agents (set hookDelivered)
    //   2. /clear reassignment (source=clear + pendingClear agent)
    if (eventName === 'SessionStart') {
      const sid = event.session_id.slice(0, 8);
      const source = (event.source as string) ?? 'unknown';
      if (debug)
        console.log(`[Pixel Agents] Hook: SessionStart(source=${source}, session=${sid}...)`);

      // Check registered mapping
      const existingAgentId = this.sessionToAgentId.get(event.session_id);
      if (existingAgentId !== undefined) {
        const agent = this.agents.get(existingAgentId);
        if (agent) {
          agent.hookDelivered = true;
        }
        if (debug)
          console.log(
            `[Pixel Agents] Hook: Agent ${existingAgentId} - SessionStart(source=${source}) known`,
          );
        return;
      }
      // Check auto-discovery (agent exists but not yet registered for hooks)
      for (const [id, agent] of this.agents) {
        if (agent.sessionId === event.session_id) {
          this.registerAgent(agent.sessionId, id);
          agent.hookDelivered = true;
          if (debug)
            console.log(
              `[Pixel Agents] Hook: Agent ${id} - SessionStart(source=${source}) auto-discovered`,
            );
          return;
        }
      }
      // /clear: find agent with pendingClear in same project dir
      if (event.source === 'clear') {
        const transcriptPath = event.transcript_path as string | undefined;
        if (transcriptPath) {
          const projectDir = path.dirname(transcriptPath);
          for (const [id, agent] of this.agents) {
            if (agent.pendingClear && agent.projectDir === projectDir) {
              agent.pendingClear = false;
              console.log(
                `[Pixel Agents] Hook: Agent ${id} - /clear detected, reassigning to ${event.session_id}`,
              );
              this.sessionToAgentId.delete(agent.sessionId);
              this.registerAgent(event.session_id, id);
              this.lifecycleCallbacks.onSessionClear?.(id, event.session_id, transcriptPath);
              return;
            }
          }
        }
      }
      // Unknown session -- ignore for now (heuristic scanners handle external detection)
      // TODO(Phase C): Add external session detection via hooks with workspace filtering
      if (debug)
        console.log(`[Pixel Agents] Hook: SessionStart -> unknown session ${sid}..., ignoring`);
      return;
    }

    // --- All other events: standard agent lookup ---
    let agentId = this.sessionToAgentId.get(event.session_id);
    if (agentId === undefined) {
      for (const [id, agent] of this.agents) {
        if (agent.sessionId === event.session_id) {
          this.registerAgent(agent.sessionId, id);
          agentId = id;
          break;
        }
      }
    }
    if (agentId === undefined) {
      if (debug)
        console.log(
          `[Pixel Agents] Hook: ${eventName} - unknown session ${event.session_id.slice(0, 8)}..., buffering`,
        );
      this.bufferEvent(_providerId, event);
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.hookDelivered = true;
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - ${eventName} (session=${event.session_id.slice(0, 8)}...)`,
      );

    const webview = this.getWebview();

    if (eventName === 'SessionEnd') {
      this.handleSessionEnd(event, agent, agentId, webview);
    } else if (eventName === 'PermissionRequest') {
      this.handlePermissionRequest(agent, agentId, webview);
    } else if (eventName === 'Notification') {
      this.handleNotification(event, agent, agentId, webview);
    } else if (eventName === 'Stop') {
      this.handleStop(agent, agentId, webview);
    }
  }

  /**
   * Handle SessionEnd: /clear marks pendingClear (SessionStart follows),
   * exit/logout marks agent waiting or triggers cleanup.
   */
  private handleSessionEnd(
    event: HookEvent,
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    const reason = event.reason as string | undefined;
    if (debug)
      console.log(
        `[Pixel Agents] Hook: Agent ${agentId} - SessionEnd(reason=${reason ?? 'unknown'})`,
      );

    if (reason === 'clear') {
      // /clear: don't clean up, SessionStart with source=clear is coming next
      agent.pendingClear = true;
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SessionEnd(reason=clear), awaiting SessionStart`,
        );
    } else {
      // Session truly ending (exit, logout, etc.)
      this.markAgentWaiting(agent, agentId, webview);
      this.lifecycleCallbacks.onSessionEnd?.(agentId, reason ?? 'unknown');
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
    if (debug && toFlush.length > 0) {
      if (debug)
        console.log(
          `[Pixel Agents] Hook: flushing ${toFlush.length} buffered event(s) for session ${sessionId.slice(0, 8)}...`,
        );
    }
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
