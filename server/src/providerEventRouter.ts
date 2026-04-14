import type * as vscode from 'vscode';

import type { AgentState } from '../../src/types.js';
import {
  type CodexStructuredEvent,
  mapCodexLifecycleEvents,
} from './providers/codex/codexEventMapper.js';

export type ProviderLifecycleEvent =
  | {
      type: 'toolStarted';
      agentId: number;
      toolId: string;
      toolName: string;
      status: string;
      parentToolId?: string;
    }
  | {
      type: 'toolCompleted';
      agentId: number;
      toolId: string;
      parentToolId?: string;
    }
  | {
      type: 'permissionRequested';
      agentId: number;
      toolId?: string;
      parentToolId?: string;
    }
  | {
      type: 'turnCompleted';
      agentId: number;
    }
  | {
      type: 'waitingForInput';
      agentId: number;
    };

export class ProviderEventRouter {
  constructor(
    private readonly agents: Map<number, AgentState>,
    private readonly getWebview: () => vscode.Webview | undefined,
  ) {}

  handleEvent(providerId: string, event: CodexStructuredEvent): boolean {
    if (providerId !== 'codex') return false;

    const agent = [...this.agents.values()].find(
      (candidate) => candidate.sessionId === event.session_id,
    );
    if (!agent) return false;

    agent.hookDelivered = true;
    const metadataHandled = this.trackCodexThreads(agent, event);
    const parentToolId = this.resolveCodexParentToolId(agent, event);
    const isRootThread = this.isCodexRootThread(agent, event);
    const lifecycleEvents = mapCodexLifecycleEvents(agent.id, event, {
      parentToolId,
      isRootThread,
    });
    for (const lifecycleEvent of lifecycleEvents) {
      this.applyLifecycleEvent(agent, lifecycleEvent);
    }
    this.finalizeCodexChildTurn(agent, event, parentToolId, isRootThread);
    this.handleCodexCloseAgent(agent, event);
    return metadataHandled || lifecycleEvents.length > 0;
  }

  private applyLifecycleEvent(agent: AgentState, event: ProviderLifecycleEvent): void {
    const webview = this.getWebview();
    if (!webview) return;

    if (event.type === 'toolStarted') {
      agent.isWaiting = false;
      agent.hadToolsInTurn = true;

      if (event.parentToolId) {
        const activeSubagentIds =
          agent.activeSubagentToolIds.get(event.parentToolId) ?? new Set<string>();
        activeSubagentIds.add(event.toolId);
        agent.activeSubagentToolIds.set(event.parentToolId, activeSubagentIds);

        const activeSubagentNames =
          agent.activeSubagentToolNames.get(event.parentToolId) ?? new Map<string, string>();
        activeSubagentNames.set(event.toolId, event.toolName);
        agent.activeSubagentToolNames.set(event.parentToolId, activeSubagentNames);

        const activeSubagentStatuses =
          agent.activeSubagentToolStatuses.get(event.parentToolId) ?? new Map<string, string>();
        activeSubagentStatuses.set(event.toolId, event.status);
        agent.activeSubagentToolStatuses.set(event.parentToolId, activeSubagentStatuses);

        webview.postMessage({
          type: 'subagentToolStart',
          id: agent.id,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
          toolName: event.toolName,
          status: event.status,
        });
        return;
      }

      agent.activeToolIds.add(event.toolId);
      agent.activeToolStatuses.set(event.toolId, event.status);
      agent.activeToolNames.set(event.toolId, event.toolName);

      webview.postMessage({
        type: 'agentStatus',
        id: agent.id,
        status: 'active',
      });
      webview.postMessage({
        type: 'agentToolStart',
        id: agent.id,
        toolId: event.toolId,
        toolName: event.toolName,
        status: event.status,
      });
      return;
    }

    if (event.type === 'toolCompleted') {
      if (event.parentToolId) {
        agent.activeSubagentToolIds.get(event.parentToolId)?.delete(event.toolId);
        agent.activeSubagentToolNames.get(event.parentToolId)?.delete(event.toolId);
        agent.activeSubagentToolStatuses.get(event.parentToolId)?.delete(event.toolId);
        webview.postMessage({
          type: 'subagentToolDone',
          id: agent.id,
          parentToolId: event.parentToolId,
          toolId: event.toolId,
        });
        return;
      }

      agent.activeToolIds.delete(event.toolId);
      agent.activeToolStatuses.delete(event.toolId);
      agent.activeToolNames.delete(event.toolId);
      webview.postMessage({
        type: 'agentToolDone',
        id: agent.id,
        toolId: event.toolId,
      });
      return;
    }

    if (event.type === 'permissionRequested') {
      agent.permissionSent = true;
      if (event.parentToolId) {
        webview.postMessage({
          type: 'subagentToolPermission',
          id: agent.id,
          parentToolId: event.parentToolId,
        });
        return;
      }
      webview.postMessage({
        type: 'agentToolPermission',
        id: agent.id,
      });
      return;
    }

    if (event.type === 'turnCompleted') {
      for (const toolId of [...agent.activeToolIds]) {
        agent.activeToolIds.delete(toolId);
        agent.activeToolStatuses.delete(toolId);
        agent.activeToolNames.delete(toolId);
        webview.postMessage({
          type: 'agentToolDone',
          id: agent.id,
          toolId,
        });
      }

      for (const [parentToolId, subagentIds] of agent.activeSubagentToolIds) {
        for (const toolId of subagentIds) {
          webview.postMessage({
            type: 'subagentToolDone',
            id: agent.id,
            parentToolId,
            toolId,
          });
        }
        webview.postMessage({
          type: 'subagentClear',
          id: agent.id,
          parentToolId,
        });
      }

      agent.activeSubagentToolIds.clear();
      agent.activeSubagentToolNames.clear();
      agent.activeSubagentToolStatuses.clear();
      agent.codexSubagentParentToolIds?.clear();
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      return;
    }

    if (event.type === 'waitingForInput') {
      agent.isWaiting = true;
      webview.postMessage({
        type: 'agentStatus',
        id: agent.id,
        status: 'waiting',
      });
    }
  }

  private trackCodexThreads(agent: AgentState, event: CodexStructuredEvent): boolean {
    const startedThreadId = this.getCodexStartedThreadId(event);
    if (startedThreadId) {
      if (!agent.codexRootThreadId) {
        agent.codexRootThreadId = startedThreadId;
      }
      return true;
    }

    const threadId = this.getCodexEventThreadId(event);
    if (!agent.codexRootThreadId && threadId) {
      agent.codexRootThreadId = threadId;
    }

    const item = this.getCodexItem(event);
    if (
      event.method === 'item/completed' &&
      item &&
      item.type === 'collabAgentToolCall' &&
      item.tool === 'spawnAgent' &&
      typeof item.id === 'string'
    ) {
      const threadMap = agent.codexSubagentParentToolIds ?? new Map<string, string>();
      agent.codexSubagentParentToolIds = threadMap;
      for (const childThreadId of this.getCodexReceiverThreadIds(item)) {
        threadMap.set(childThreadId, item.id);
      }
      return true;
    }

    return false;
  }

  private resolveCodexParentToolId(
    agent: AgentState,
    event: CodexStructuredEvent,
  ): string | undefined {
    const item = this.getCodexItem(event);
    const source =
      item?.source && typeof item.source === 'object' && !Array.isArray(item.source)
        ? (item.source as Record<string, unknown>)
        : undefined;
    const sourceType = source?.type ?? source?.kind;
    if (sourceType === 'subAgent' && typeof source?.parentItemId === 'string') {
      return source.parentItemId;
    }

    const threadId = this.getCodexEventThreadId(event);
    if (!threadId) return undefined;
    return agent.codexSubagentParentToolIds?.get(threadId);
  }

  private isCodexRootThread(agent: AgentState, event: CodexStructuredEvent): boolean {
    const threadId = this.getCodexEventThreadId(event);
    if (!threadId) return true;
    if (!agent.codexRootThreadId) return true;
    return threadId === agent.codexRootThreadId;
  }

  private finalizeCodexChildTurn(
    agent: AgentState,
    event: CodexStructuredEvent,
    parentToolId: string | undefined,
    isRootThread: boolean,
  ): void {
    if (event.method !== 'turn/completed' || isRootThread || !parentToolId) {
      return;
    }

    const webview = this.getWebview();
    if (!webview) return;

    const subagentIds = agent.activeSubagentToolIds.get(parentToolId);
    if (subagentIds) {
      for (const toolId of subagentIds) {
        webview.postMessage({
          type: 'subagentToolDone',
          id: agent.id,
          parentToolId,
          toolId,
        });
      }
    }
    agent.activeSubagentToolIds.delete(parentToolId);
    agent.activeSubagentToolNames.delete(parentToolId);
    agent.activeSubagentToolStatuses.delete(parentToolId);
  }

  private handleCodexCloseAgent(agent: AgentState, event: CodexStructuredEvent): void {
    const item = this.getCodexItem(event);
    if (
      event.method !== 'item/completed' ||
      !item ||
      item.type !== 'collabAgentToolCall' ||
      item.tool !== 'closeAgent'
    ) {
      return;
    }

    const webview = this.getWebview();
    if (!webview) return;

    for (const childThreadId of this.getCodexReceiverThreadIds(item)) {
      const parentToolId = agent.codexSubagentParentToolIds?.get(childThreadId);
      if (!parentToolId) continue;

      agent.codexSubagentParentToolIds?.delete(childThreadId);
      agent.activeSubagentToolIds.delete(parentToolId);
      agent.activeSubagentToolNames.delete(parentToolId);
      agent.activeSubagentToolStatuses.delete(parentToolId);
      webview.postMessage({
        type: 'subagentClear',
        id: agent.id,
        parentToolId,
      });
    }
  }

  private getCodexStartedThreadId(event: CodexStructuredEvent): string | undefined {
    if (event.method !== 'thread/started') return undefined;
    const thread =
      event.params?.thread &&
      typeof event.params.thread === 'object' &&
      !Array.isArray(event.params.thread)
        ? (event.params.thread as Record<string, unknown>)
        : undefined;
    return typeof thread?.id === 'string' ? thread.id : undefined;
  }

  private getCodexEventThreadId(event: CodexStructuredEvent): string | undefined {
    if (typeof event.params?.threadId === 'string') {
      return event.params.threadId;
    }

    const item = this.getCodexItem(event);
    return typeof item?.senderThreadId === 'string' ? item.senderThreadId : undefined;
  }

  private getCodexItem(event: CodexStructuredEvent): Record<string, unknown> | undefined {
    const item = event.params?.item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return undefined;
    }
    return item as Record<string, unknown>;
  }

  private getCodexReceiverThreadIds(item: Record<string, unknown>): string[] {
    const raw = item.receiverThreadIds;
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is string => typeof value === 'string');
  }
}
