import type * as vscode from 'vscode';

import { PERMISSION_TIMER_DELAY_MS } from './constants.js';
import type { AgentState } from './types.js';

export function clearAgentActivity(
  agent: AgentState | undefined,
  agentId: number,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  if (!agent) return;
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();
  agent.activeToolNames.clear();
  agent.activeToolActivities.clear();
  agent.activeSubagentToolIds.clear();
  agent.activeSubagentToolNames.clear();
  agent.activeSubagentToolActivities.clear();
  agent.isWaiting = false;
  agent.permissionSent = false;
  agent.currentStatus = 'active';
  cancelPermissionTimer(agentId, permissionTimers);
  webview?.postMessage({ type: 'agentToolsClear', id: agentId });
  webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
}

export function cancelWaitingTimer(
  agentId: number,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
  const timer = waitingTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    waitingTimers.delete(agentId);
  }
}

export function startWaitingTimer(
  agentId: number,
  delayMs: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  cancelWaitingTimer(agentId, waitingTimers);
  const scheduledAt = Date.now();
  const timer = setTimeout(() => {
    waitingTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (agent && agent.lastActivityAt <= scheduledAt) {
      agent.isWaiting = true;
      agent.lastActivityAt = Date.now();
      agent.currentStatus = 'waiting';
      webview?.postMessage({
        type: 'agentStatus',
        id: agentId,
        status: 'waiting',
        source: 'heuristic',
        inferred: true,
        confidence: 'low',
      });
    }
  }, delayMs);
  waitingTimers.set(agentId, timer);
}

export function cancelPermissionTimer(
  agentId: number,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
  const timer = permissionTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    permissionTimers.delete(agentId);
  }
}

export function startPermissionTimer(
  agentId: number,
  agents: Map<number, AgentState>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionExemptTools: Set<string>,
  webview: vscode.Webview | undefined,
): void {
  cancelPermissionTimer(agentId, permissionTimers);
  const timer = setTimeout(() => {
    permissionTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) return;

    // Only flag if there are still active non-exempt tools (parent or sub-agent)
    let hasNonExempt = false;
    const permissionToolIds: string[] = [];
    for (const toolId of agent.activeToolIds) {
      const toolName = agent.activeToolNames.get(toolId);
      if (!permissionExemptTools.has(toolName || '')) {
        hasNonExempt = true;
        permissionToolIds.push(toolId);
        const activity = agent.activeToolActivities.get(toolId);
        if (activity) {
          activity.permissionState = 'pending';
        }
      }
    }

    // Check sub-agent tools for non-exempt tools
    const stuckSubagentParentToolIds: string[] = [];
    for (const [parentToolId, subToolNames] of agent.activeSubagentToolNames) {
      for (const [, toolName] of subToolNames) {
        if (!permissionExemptTools.has(toolName)) {
          stuckSubagentParentToolIds.push(parentToolId);
          hasNonExempt = true;
          const subActivities = agent.activeSubagentToolActivities.get(parentToolId);
          if (subActivities) {
            for (const [, activity] of subActivities) {
              if (!permissionExemptTools.has(activity.toolName)) {
                activity.permissionState = 'pending';
              }
            }
          }
          break;
        }
      }
    }

    if (hasNonExempt) {
      agent.permissionSent = true;
      console.log(`[Pixel Agents] Agent ${agentId}: possible permission wait detected`);
      webview?.postMessage({
        type: 'agentToolPermission',
        id: agentId,
        toolIds: permissionToolIds,
        source: 'heuristic',
        inferred: true,
        confidence: 'low',
      });
      // Also notify stuck sub-agents
      for (const parentToolId of stuckSubagentParentToolIds) {
        webview?.postMessage({
          type: 'subagentToolPermission',
          id: agentId,
          parentToolId,
          source: 'heuristic',
          inferred: true,
          confidence: 'low',
        });
      }
    }
  }, PERMISSION_TIMER_DELAY_MS);
  permissionTimers.set(agentId, timer);
}
