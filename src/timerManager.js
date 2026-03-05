"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearAgentActivity = clearAgentActivity;
exports.cancelWaitingTimer = cancelWaitingTimer;
exports.startWaitingTimer = startWaitingTimer;
exports.cancelPermissionTimer = cancelPermissionTimer;
exports.startPermissionTimer = startPermissionTimer;
const constants_js_1 = require("./constants.js");
function clearAgentActivity(agent, agentId, permissionTimers, webview) {
    if (!agent)
        return;
    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    agent.activeSubagentToolIds.clear();
    agent.activeSubagentToolNames.clear();
    agent.isWaiting = false;
    agent.permissionSent = false;
    cancelPermissionTimer(agentId, permissionTimers);
    webview?.postMessage({ type: 'agentToolsClear', id: agentId });
    webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
}
function cancelWaitingTimer(agentId, waitingTimers) {
    const timer = waitingTimers.get(agentId);
    if (timer) {
        clearTimeout(timer);
        waitingTimers.delete(agentId);
    }
}
function startWaitingTimer(agentId, delayMs, agents, waitingTimers, webview) {
    cancelWaitingTimer(agentId, waitingTimers);
    const timer = setTimeout(() => {
        waitingTimers.delete(agentId);
        const agent = agents.get(agentId);
        if (agent) {
            agent.isWaiting = true;
        }
        webview?.postMessage({
            type: 'agentStatus',
            id: agentId,
            status: 'waiting',
        });
    }, delayMs);
    waitingTimers.set(agentId, timer);
}
function cancelPermissionTimer(agentId, permissionTimers) {
    const timer = permissionTimers.get(agentId);
    if (timer) {
        clearTimeout(timer);
        permissionTimers.delete(agentId);
    }
}
function startPermissionTimer(agentId, agents, permissionTimers, permissionExemptTools, webview) {
    cancelPermissionTimer(agentId, permissionTimers);
    const timer = setTimeout(() => {
        permissionTimers.delete(agentId);
        const agent = agents.get(agentId);
        if (!agent)
            return;
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
        const stuckSubagentParentToolIds = [];
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
            webview?.postMessage({
                type: 'agentToolPermission',
                id: agentId,
            });
            // Also notify stuck sub-agents
            for (const parentToolId of stuckSubagentParentToolIds) {
                webview?.postMessage({
                    type: 'subagentToolPermission',
                    id: agentId,
                    parentToolId,
                });
            }
        }
    }, constants_js_1.PERMISSION_TIMER_DELAY_MS);
    permissionTimers.set(agentId, timer);
}
//# sourceMappingURL=timerManager.js.map