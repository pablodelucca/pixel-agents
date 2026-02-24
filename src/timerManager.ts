import type { BaseAgentState } from './types.js';
import type { MessageSink } from './messages.js';
import { PERMISSION_TIMER_DELAY_MS } from './constants.js';
import { postToWebview } from './messages.js';

export function clearAgentActivity(
	agent: BaseAgentState | undefined,
	agentId: number,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: MessageSink | undefined,
): void {
	if (!agent) return;
	agent.activeToolIds.clear();
	agent.activeToolStatuses.clear();
	agent.activeToolNames.clear();
	agent.activeSubagentToolIds.clear();
	agent.activeSubagentToolNames.clear();
	agent.isWaiting = false;
	agent.permissionSent = false;
	cancelPermissionTimer(agentId, permissionTimers);
	postToWebview(webview, { type: 'agentToolsClear', id: agentId });
	postToWebview(webview, { type: 'agentStatus', id: agentId, status: 'active' });
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
	agents: Map<number, BaseAgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	webview: MessageSink | undefined,
): void {
	cancelWaitingTimer(agentId, waitingTimers);
	const timer = setTimeout(() => {
		waitingTimers.delete(agentId);
		const agent = agents.get(agentId);
		if (agent) {
			agent.isWaiting = true;
		}
		postToWebview(webview, {
			type: 'agentStatus',
			id: agentId,
			status: 'waiting',
		});
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
	agents: Map<number, BaseAgentState>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionExemptTools: Set<string>,
	webview: MessageSink | undefined,
): void {
	cancelPermissionTimer(agentId, permissionTimers);
	const timer = setTimeout(() => {
		permissionTimers.delete(agentId);
		const agent = agents.get(agentId);
		if (!agent) return;

		// Only flag if there are still active non-exempt tools (parent or sub-agent)
		let hasNonExempt = false;
		for (const toolId of agent.activeToolIds) {
			const toolName = agent.activeToolNames.get(toolId);
			if (!permissionExemptTools.has(toolName || '')) {
				hasNonExempt = true;
				break;
			}
		}

		// Check sub-agent tools for non-exempt tools
		const stuckSubagentParentToolIds: string[] = [];
		for (const [parentToolId, subToolNames] of agent.activeSubagentToolNames) {
			for (const [, toolName] of subToolNames) {
				if (!permissionExemptTools.has(toolName)) {
					stuckSubagentParentToolIds.push(parentToolId);
					hasNonExempt = true;
					break;
				}
			}
		}

		if (hasNonExempt) {
			agent.permissionSent = true;
			console.log(`[Pixel Agents] Agent ${agentId}: possible permission wait detected`);
			postToWebview(webview, {
				type: 'agentToolPermission',
				id: agentId,
			});
			// Also notify stuck sub-agents
			for (const parentToolId of stuckSubagentParentToolIds) {
				postToWebview(webview, {
					type: 'subagentToolPermission',
					id: agentId,
					parentToolId,
				});
			}
		}
	}, PERMISSION_TIMER_DELAY_MS);
	permissionTimers.set(agentId, timer);
}
