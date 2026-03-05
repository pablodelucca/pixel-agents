"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_EXEMPT_TOOLS = void 0;
exports.formatToolStatus = formatToolStatus;
exports.processTranscriptLine = processTranscriptLine;
const path = __importStar(require("path"));
const timerManager_js_1 = require("./timerManager.js");
const constants_js_1 = require("./constants.js");
exports.PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);
function formatToolStatus(toolName, input) {
    const base = (p) => typeof p === 'string' ? path.basename(p) : '';
    switch (toolName) {
        case 'Read': return `Reading ${base(input.file_path)}`;
        case 'Edit': return `Editing ${base(input.file_path)}`;
        case 'Write': return `Writing ${base(input.file_path)}`;
        case 'Bash': {
            const cmd = input.command || '';
            return `Running: ${cmd.length > constants_js_1.BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, constants_js_1.BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
        }
        case 'Glob': return 'Searching files';
        case 'Grep': return 'Searching code';
        case 'WebFetch': return 'Fetching web content';
        case 'WebSearch': return 'Searching the web';
        case 'Task': {
            const desc = typeof input.description === 'string' ? input.description : '';
            return desc ? `Subtask: ${desc.length > constants_js_1.TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, constants_js_1.TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '\u2026' : desc}` : 'Running subtask';
        }
        case 'AskUserQuestion': return 'Waiting for your answer';
        case 'EnterPlanMode': return 'Planning';
        case 'NotebookEdit': return `Editing notebook`;
        default: return `Using ${toolName}`;
    }
}
function processTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview) {
    const agent = agents.get(agentId);
    if (!agent)
        return;
    try {
        const record = JSON.parse(line);
        if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
            const blocks = record.message.content;
            const hasToolUse = blocks.some(b => b.type === 'tool_use');
            if (hasToolUse) {
                (0, timerManager_js_1.cancelWaitingTimer)(agentId, waitingTimers);
                agent.isWaiting = false;
                agent.hadToolsInTurn = true;
                webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
                let hasNonExemptTool = false;
                for (const block of blocks) {
                    if (block.type === 'tool_use' && block.id) {
                        const toolName = block.name || '';
                        const status = formatToolStatus(toolName, block.input || {});
                        console.log(`[Pixel Agents] Agent ${agentId} tool start: ${block.id} ${status}`);
                        agent.activeToolIds.add(block.id);
                        agent.activeToolStatuses.set(block.id, status);
                        agent.activeToolNames.set(block.id, toolName);
                        if (!exports.PERMISSION_EXEMPT_TOOLS.has(toolName)) {
                            hasNonExemptTool = true;
                        }
                        webview?.postMessage({
                            type: 'agentToolStart',
                            id: agentId,
                            toolId: block.id,
                            status,
                        });
                    }
                }
                if (hasNonExemptTool) {
                    (0, timerManager_js_1.startPermissionTimer)(agentId, agents, permissionTimers, exports.PERMISSION_EXEMPT_TOOLS, webview);
                }
            }
            else if (blocks.some(b => b.type === 'text') && !agent.hadToolsInTurn) {
                // Text-only response in a turn that hasn't used any tools.
                // turn_duration handles tool-using turns reliably but is never
                // emitted for text-only turns, so we use a silence-based timer:
                // if no new JSONL data arrives within TEXT_IDLE_DELAY_MS, mark as waiting.
                (0, timerManager_js_1.startWaitingTimer)(agentId, constants_js_1.TEXT_IDLE_DELAY_MS, agents, waitingTimers, webview);
            }
        }
        else if (record.type === 'progress') {
            processProgressRecord(agentId, record, agents, waitingTimers, permissionTimers, webview);
        }
        else if (record.type === 'user') {
            const content = record.message?.content;
            if (Array.isArray(content)) {
                const blocks = content;
                const hasToolResult = blocks.some(b => b.type === 'tool_result');
                if (hasToolResult) {
                    for (const block of blocks) {
                        if (block.type === 'tool_result' && block.tool_use_id) {
                            console.log(`[Pixel Agents] Agent ${agentId} tool done: ${block.tool_use_id}`);
                            const completedToolId = block.tool_use_id;
                            // If the completed tool was a Task, clear its subagent tools
                            if (agent.activeToolNames.get(completedToolId) === 'Task') {
                                agent.activeSubagentToolIds.delete(completedToolId);
                                agent.activeSubagentToolNames.delete(completedToolId);
                                webview?.postMessage({
                                    type: 'subagentClear',
                                    id: agentId,
                                    parentToolId: completedToolId,
                                });
                            }
                            agent.activeToolIds.delete(completedToolId);
                            agent.activeToolStatuses.delete(completedToolId);
                            agent.activeToolNames.delete(completedToolId);
                            const toolId = completedToolId;
                            setTimeout(() => {
                                webview?.postMessage({
                                    type: 'agentToolDone',
                                    id: agentId,
                                    toolId,
                                });
                            }, constants_js_1.TOOL_DONE_DELAY_MS);
                        }
                    }
                    // All tools completed — allow text-idle timer as fallback
                    // for turn-end detection when turn_duration is not emitted
                    if (agent.activeToolIds.size === 0) {
                        agent.hadToolsInTurn = false;
                    }
                }
                else {
                    // New user text prompt — new turn starting
                    (0, timerManager_js_1.cancelWaitingTimer)(agentId, waitingTimers);
                    (0, timerManager_js_1.clearAgentActivity)(agent, agentId, permissionTimers, webview);
                    agent.hadToolsInTurn = false;
                }
            }
            else if (typeof content === 'string' && content.trim()) {
                // New user text prompt — new turn starting
                (0, timerManager_js_1.cancelWaitingTimer)(agentId, waitingTimers);
                (0, timerManager_js_1.clearAgentActivity)(agent, agentId, permissionTimers, webview);
                agent.hadToolsInTurn = false;
            }
        }
        else if (record.type === 'system' && record.subtype === 'turn_duration') {
            (0, timerManager_js_1.cancelWaitingTimer)(agentId, waitingTimers);
            (0, timerManager_js_1.cancelPermissionTimer)(agentId, permissionTimers);
            // Definitive turn-end: clean up any stale tool state
            if (agent.activeToolIds.size > 0) {
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
    }
    catch {
        // Ignore malformed lines
    }
}
function processProgressRecord(agentId, record, agents, waitingTimers, permissionTimers, webview) {
    const agent = agents.get(agentId);
    if (!agent)
        return;
    const parentToolId = record.parentToolUseID;
    if (!parentToolId)
        return;
    const data = record.data;
    if (!data)
        return;
    // bash_progress / mcp_progress: tool is actively executing, not stuck on permission.
    // Restart the permission timer to give the running tool another window.
    const dataType = data.type;
    if (dataType === 'bash_progress' || dataType === 'mcp_progress') {
        if (agent.activeToolIds.has(parentToolId)) {
            (0, timerManager_js_1.startPermissionTimer)(agentId, agents, permissionTimers, exports.PERMISSION_EXEMPT_TOOLS, webview);
        }
        return;
    }
    // Verify parent is an active Task tool (agent_progress handling)
    if (agent.activeToolNames.get(parentToolId) !== 'Task')
        return;
    const msg = data.message;
    if (!msg)
        return;
    const msgType = msg.type;
    const innerMsg = msg.message;
    const content = innerMsg?.content;
    if (!Array.isArray(content))
        return;
    if (msgType === 'assistant') {
        let hasNonExemptSubTool = false;
        for (const block of content) {
            if (block.type === 'tool_use' && block.id) {
                const toolName = block.name || '';
                const status = formatToolStatus(toolName, block.input || {});
                console.log(`[Pixel Agents] Agent ${agentId} subagent tool start: ${block.id} ${status} (parent: ${parentToolId})`);
                // Track sub-tool IDs
                let subTools = agent.activeSubagentToolIds.get(parentToolId);
                if (!subTools) {
                    subTools = new Set();
                    agent.activeSubagentToolIds.set(parentToolId, subTools);
                }
                subTools.add(block.id);
                // Track sub-tool names (for permission checking)
                let subNames = agent.activeSubagentToolNames.get(parentToolId);
                if (!subNames) {
                    subNames = new Map();
                    agent.activeSubagentToolNames.set(parentToolId, subNames);
                }
                subNames.set(block.id, toolName);
                if (!exports.PERMISSION_EXEMPT_TOOLS.has(toolName)) {
                    hasNonExemptSubTool = true;
                }
                webview?.postMessage({
                    type: 'subagentToolStart',
                    id: agentId,
                    parentToolId,
                    toolId: block.id,
                    status,
                });
            }
        }
        if (hasNonExemptSubTool) {
            (0, timerManager_js_1.startPermissionTimer)(agentId, agents, permissionTimers, exports.PERMISSION_EXEMPT_TOOLS, webview);
        }
    }
    else if (msgType === 'user') {
        for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
                console.log(`[Pixel Agents] Agent ${agentId} subagent tool done: ${block.tool_use_id} (parent: ${parentToolId})`);
                // Remove from tracking
                const subTools = agent.activeSubagentToolIds.get(parentToolId);
                if (subTools) {
                    subTools.delete(block.tool_use_id);
                }
                const subNames = agent.activeSubagentToolNames.get(parentToolId);
                if (subNames) {
                    subNames.delete(block.tool_use_id);
                }
                const toolId = block.tool_use_id;
                setTimeout(() => {
                    webview?.postMessage({
                        type: 'subagentToolDone',
                        id: agentId,
                        parentToolId,
                        toolId,
                    });
                }, 300);
            }
        }
        // If there are still active non-exempt sub-agent tools, restart the permission timer
        // (handles the case where one sub-agent completes but another is still stuck)
        let stillHasNonExempt = false;
        for (const [, subNames] of agent.activeSubagentToolNames) {
            for (const [, toolName] of subNames) {
                if (!exports.PERMISSION_EXEMPT_TOOLS.has(toolName)) {
                    stillHasNonExempt = true;
                    break;
                }
            }
            if (stillHasNonExempt)
                break;
        }
        if (stillHasNonExempt) {
            (0, timerManager_js_1.startPermissionTimer)(agentId, agents, permissionTimers, exports.PERMISSION_EXEMPT_TOOLS, webview);
        }
    }
}
//# sourceMappingURL=transcriptParser.js.map