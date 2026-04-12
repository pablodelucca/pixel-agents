// TODO(Standalone version): Replace vscode.Webview with MessageSender interface from core/src/messages.ts
// TODO(Standalone version): Move timerManager and types to server/src/ to eliminate cross-boundary imports
import * as path from 'path';
import type * as vscode from 'vscode';

import { cancelPermissionTimer, cancelWaitingTimer } from '../../src/timerManager.js';
import { formatToolStatus } from '../../src/transcriptParser.js';
import type { AgentState } from '../../src/types.js';
import { HOOK_EVENT_BUFFER_MS, SESSION_END_GRACE_MS } from './constants.js';

const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

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
interface SessionLifecycleCallbacks {
  /** Called when an external session is detected (unknown session_id in SessionStart).
   *  transcriptPath is undefined for providers without transcripts (OpenCode, Copilot). */
  onExternalSessionDetected?: (
    sessionId: string,
    transcriptPath: string | undefined,
    cwd: string,
  ) => void;
  /** Called when /clear is detected via hooks (SessionEnd reason=clear + SessionStart source=clear). */
  onSessionClear?: (
    agentId: number,
    newSessionId: string,
    newTranscriptPath: string | undefined,
  ) => void;
  /** Called when a session is resumed (--resume). Clears dismissals so the file can be re-adopted. */
  onSessionResume?: (transcriptPath: string) => void;
  /** Called when a session ends (exit/logout). */
  onSessionEnd?: (agentId: number, reason: string) => void;
}

/** Pending external session info (waiting for confirmation event before creating agent). */
interface PendingExternalSession {
  sessionId: string;
  /** Transcript file path. Undefined for providers without transcripts (OpenCode, Copilot). */
  transcriptPath: string | undefined;
  cwd: string;
}

export class HookEventHandler {
  private sessionToAgentId = new Map<string, number>();
  private bufferedEvents: BufferedEvent[] = [];
  private bufferTimer: ReturnType<typeof setInterval> | null = null;
  private lifecycleCallbacks: SessionLifecycleCallbacks = {};
  /** Pending external sessions waiting for a confirmation event (Stop, Notification, etc.). */
  private pendingExternalSessions = new Map<string, PendingExternalSession>();

  constructor(
    private agents: Map<number, AgentState>,
    private waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    private permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    private getWebview: () => vscode.Webview | undefined,
    private watchAllSessionsRef?: { current: boolean },
  ) {}

  /** Check if a session is tracked (in workspace project dir, or Watch All Sessions ON). */
  private isTrackedSession(transcriptPath?: string, cwd?: string): boolean {
    if (this.watchAllSessionsRef?.current) return true;
    const projectDir = transcriptPath ? path.dirname(transcriptPath) : cwd;
    if (!projectDir) return false;
    return [...this.agents.values()].some(
      (a) => path.resolve(a.projectDir).toLowerCase() === path.resolve(projectDir).toLowerCase(),
    );
  }

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
      const tracked = this.isTrackedSession(
        event.transcript_path as string | undefined,
        event.cwd as string | undefined,
      );
      if (debug && tracked)
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
      // /clear or /resume: reassign existing agent to new session
      if (event.source === 'clear' || event.source === 'resume') {
        const transcriptPath = event.transcript_path as string | undefined;
        const projectDir = transcriptPath
          ? path.dirname(transcriptPath)
          : (event.cwd as string | undefined);
        if (projectDir) {
          for (const [id, agent] of this.agents) {
            // Both /clear and /resume send SessionEnd first (sets pendingClear),
            // then SessionStart. Match the agent that has pendingClear in same project dir.
            // Normalize paths for cross-platform comparison (separators + case-insensitive
            // for Windows where drive letter casing differs: c:\ vs C:\).
            const isMatch =
              agent.pendingClear &&
              path.resolve(agent.projectDir).toLowerCase() ===
                path.resolve(projectDir).toLowerCase();
            if (isMatch) {
              agent.pendingClear = false;
              console.log(
                `[Pixel Agents] Hook: Agent ${id} - /${event.source} detected, reassigning to ${event.session_id}`,
              );
              this.sessionToAgentId.delete(agent.sessionId);
              this.registerAgent(event.session_id, id);
              this.lifecycleCallbacks.onSessionClear?.(id, event.session_id, transcriptPath);
              return;
            }
          }
        }
      }
      // Unknown session -- store as pending, create only when a confirmation event
      // arrives (Stop, Notification, PermissionRequest). This filters transient sessions
      // from Claude Code Extension which fire SessionStart + SessionEnd without any activity.
      const transcriptPath2 = event.transcript_path as string | undefined;
      const cwd = event.cwd as string | undefined;
      if (transcriptPath2 || cwd) {
        // For --resume, clear dismissals so the file can be re-adopted
        if (event.source === 'resume' && transcriptPath2) {
          this.lifecycleCallbacks.onSessionResume?.(transcriptPath2);
        }
        if (debug && tracked)
          console.log(
            `[Pixel Agents] Hook: SessionStart(source=${source}) -> pending external session ${sid}..., awaiting confirmation`,
          );
        this.pendingExternalSessions.set(event.session_id, {
          sessionId: event.session_id,
          transcriptPath: transcriptPath2,
          cwd: cwd ?? '',
        });
      } else {
        if (debug && tracked)
          console.log(
            `[Pixel Agents] Hook: SessionStart -> unknown session ${sid}..., no transcript_path`,
          );
      }
      return;
    }

    // --- All other events: standard agent lookup ---
    // If SessionEnd arrives for a pending external session, discard it (transient session)
    if (eventName === 'SessionEnd' && this.pendingExternalSessions.has(event.session_id)) {
      this.pendingExternalSessions.delete(event.session_id);
      if (debug)
        console.log(
          `[Pixel Agents] Hook: SessionEnd discarded pending external session ${event.session_id.slice(0, 8)}...`,
        );
      return;
    }

    // If a confirmation event arrives for a pending external session, create the agent first
    if (this.pendingExternalSessions.has(event.session_id)) {
      const pending = this.pendingExternalSessions.get(event.session_id)!;
      this.pendingExternalSessions.delete(event.session_id);
      if (debug)
        console.log(
          `[Pixel Agents] Hook: ${eventName} confirmed external session ${event.session_id.slice(0, 8)}..., creating agent`,
        );
      this.lifecycleCallbacks.onExternalSessionDetected?.(
        pending.sessionId,
        pending.transcriptPath,
        pending.cwd,
      );
      // Re-process this event now that the agent exists
      this.handleEvent(_providerId, event);
      return;
    }

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
      // Buffer if: pending external session, already buffering for this session,
      // OR agents exist that haven't been registered yet (internal agent race:
      // hook event arrives before registerAgent is called after launchNewTerminal).
      // Silently drop events for sessions we have no record of
      // (e.g. other projects with Watch All OFF).
      const isPending = this.pendingExternalSessions.has(event.session_id);
      const hasBuffered = this.bufferedEvents.some((b) => b.event.session_id === event.session_id);
      const hasUnregisteredAgents = [...this.agents.values()].some(
        (a) => a.sessionId && !this.sessionToAgentId.has(a.sessionId),
      );
      if (isPending || hasBuffered || hasUnregisteredAgents) {
        if (debug)
          console.log(
            `[Pixel Agents] Hook: ${eventName} - unknown session ${event.session_id.slice(0, 8)}..., buffering`,
          );
        this.bufferEvent(_providerId, event);
      }
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
    } else if (eventName === 'PreToolUse') {
      this.handlePreToolUse(event, agent, agentId, webview);
    } else if (eventName === 'PostToolUse') {
      this.handlePostToolUse(event, agent, agentId, webview);
    } else if (eventName === 'PostToolUseFailure') {
      this.handlePostToolUseFailure(event, agent, agentId, webview);
    } else if (eventName === 'SubagentStart') {
      this.handleSubagentStart(event, agent, agentId, webview);
    } else if (eventName === 'SubagentStop') {
      this.handleSubagentStop(event, agent, agentId, webview);
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

    // /clear and /resume send SessionEnd then SessionStart. Wait briefly for the follow-up.
    // All other reasons (exit, logout, prompt_input_exit) are final -- despawn immediately.
    const expectsFollowUp = reason === 'clear' || reason === 'resume';

    if (expectsFollowUp) {
      agent.pendingClear = true;
      this.markAgentWaiting(agent, agentId, webview);
      if (debug)
        console.log(
          `[Pixel Agents] Hook: Agent ${agentId} - SessionEnd(reason=${reason}), awaiting possible SessionStart`,
        );
      // Safety net: if SessionStart never arrives, clean up the zombie agent
      setTimeout(() => {
        if (agent.pendingClear) {
          agent.pendingClear = false;
          this.lifecycleCallbacks.onSessionEnd?.(agentId, reason);
        }
      }, SESSION_END_GRACE_MS);
    } else {
      // Immediate cleanup for exit/logout
      this.markAgentWaiting(agent, agentId, webview);
      this.lifecycleCallbacks.onSessionEnd?.(agentId, reason ?? 'unknown');
    }
  }

  /**
   * Handle PreToolUse: instantly mark agent as active (cancel waiting state).
   * JSONL still handles detailed tool tracking (toolId, status text, webview messages).
   * This just ensures the character starts animating without waiting for the 500ms JSONL poll.
   */
  private handlePreToolUse(
    event: HookEvent,
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    const toolName = (event.tool_name as string) ?? '';
    const toolInput = (event.tool_input as Record<string, unknown>) ?? {};
    const status = formatToolStatus(toolName, toolInput);
    const hookToolId = `hook-${Date.now()}`;

    // Track for PostToolUse correlation
    agent.currentHookToolId = hookToolId;

    // Cancel waiting, mark active
    cancelWaitingTimer(agentId, this.waitingTimers);
    agent.isWaiting = false;
    agent.permissionSent = false;
    agent.hadToolsInTurn = true;

    // Send tool start + active state to webview (instant, no 500ms JSONL delay)
    webview?.postMessage({
      type: 'agentToolStart',
      id: agentId,
      toolId: hookToolId,
      status,
      toolName,
    });
    webview?.postMessage({
      type: 'agentStatus',
      id: agentId,
      status: 'active',
    });
  }

  /**
   * Handle PostToolUse: no action needed. JSONL handles tool_result processing.
   * Stop hook handles the idle transition. This is here for completeness and
   * to serve as a confirmation event for pending external sessions.
   */
  private handlePostToolUse(
    _event: HookEvent,
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    if (agent.currentHookToolId) {
      webview?.postMessage({
        type: 'agentToolDone',
        id: agentId,
        toolId: agent.currentHookToolId,
      });
      agent.currentHookToolId = undefined;
    }
  }

  /**
   * Handle PostToolUseFailure: send tool done for the failed tool,
   * keep agent active (Claude will retry or respond with error).
   */
  private handlePostToolUseFailure(
    _event: HookEvent,
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    if (agent.currentHookToolId) {
      webview?.postMessage({
        type: 'agentToolDone',
        id: agentId,
        toolId: agent.currentHookToolId,
      });
      agent.currentHookToolId = undefined;
    }
  }

  /**
   * Handle SubagentStart: notify webview that a sub-agent is spawning.
   * Creates the child character in the office immediately via hooks,
   * without waiting for JSONL agent_progress records (500ms polling).
   */
  private handleSubagentStart(
    event: HookEvent,
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    // Find the parent Task/Agent tool ID that spawned this sub-agent.
    // If we can't find one (hook arrived before JSONL tracked the parent tool),
    // skip -- JSONL will handle it on the next poll.
    const agentType = (event.agent_type as string) ?? 'unknown';
    let parentToolId: string | undefined;
    for (const [toolId, toolName] of agent.activeToolNames) {
      if (toolName === 'Task' || toolName === 'Agent') {
        parentToolId = toolId;
        break;
      }
    }
    if (!parentToolId) return; // JSONL will handle it

    const subToolId = `hook-sub-${agentType}-${Date.now()}`;
    const status = `Subtask: ${agentType}`;

    // Track sub-agent
    let subTools = agent.activeSubagentToolIds.get(parentToolId);
    if (!subTools) {
      subTools = new Set();
      agent.activeSubagentToolIds.set(parentToolId, subTools);
    }
    subTools.add(subToolId);

    let subNames = agent.activeSubagentToolNames.get(parentToolId);
    if (!subNames) {
      subNames = new Map();
      agent.activeSubagentToolNames.set(parentToolId, subNames);
    }
    subNames.set(subToolId, agentType);

    webview?.postMessage({
      type: 'subagentToolStart',
      id: agentId,
      parentToolId,
      toolId: subToolId,
      status,
    });
  }

  /**
   * Handle SubagentStop: notify webview that a sub-agent finished.
   * Removes the child character from the office.
   */
  private handleSubagentStop(
    _event: HookEvent,
    agent: AgentState,
    agentId: number,
    webview: vscode.Webview | undefined,
  ): void {
    // Find parent tool and clear all sub-agent tracking for it.
    // SubagentStop doesn't give us the specific sub-tool ID, so clear all
    // sub-agents under the first matching Task/Agent parent.
    let parentToolId: string | undefined;
    for (const [toolId, toolName] of agent.activeToolNames) {
      if (toolName === 'Task' || toolName === 'Agent') {
        parentToolId = toolId;
        break;
      }
    }
    if (!parentToolId) return;

    agent.activeSubagentToolIds.delete(parentToolId);
    agent.activeSubagentToolNames.delete(parentToolId);
    webview?.postMessage({
      type: 'subagentClear',
      id: agentId,
      parentToolId,
    });
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
    this.pendingExternalSessions.clear();
  }
}
