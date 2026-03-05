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
exports.getProjectDirPath = getProjectDirPath;
exports.launchNewTerminal = launchNewTerminal;
exports.removeAgent = removeAgent;
exports.persistAgents = persistAgents;
exports.restoreAgents = restoreAgents;
exports.sendExistingAgents = sendExistingAgents;
exports.sendCurrentAgentStatuses = sendCurrentAgentStatuses;
exports.sendLayout = sendLayout;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const vscode = __importStar(require("vscode"));
const timerManager_js_1 = require("./timerManager.js");
const fileWatcher_js_1 = require("./fileWatcher.js");
const constants_js_1 = require("./constants.js");
const layoutPersistence_js_1 = require("./layoutPersistence.js");
function getProjectDirPath(cwd) {
    const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath)
        return null;
    const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
    const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);
    console.log(`[Pixel Agents] Project dir: ${workspacePath} → ${dirName}`);
    return projectDir;
}
async function launchNewTerminal(nextAgentIdRef, nextTerminalIndexRef, agents, activeAgentIdRef, knownJsonlFiles, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, projectScanTimerRef, webview, persistAgents, folderPath) {
    const folders = vscode.workspace.workspaceFolders;
    const cwd = folderPath || folders?.[0]?.uri.fsPath;
    const isMultiRoot = !!(folders && folders.length > 1);
    const idx = nextTerminalIndexRef.current++;
    const terminal = vscode.window.createTerminal({
        name: `${constants_js_1.TERMINAL_NAME_PREFIX} #${idx}`,
        cwd,
    });
    terminal.show();
    const sessionId = crypto.randomUUID();
    terminal.sendText(`claude --session-id ${sessionId}`);
    const projectDir = getProjectDirPath(cwd);
    if (!projectDir) {
        console.log(`[Pixel Agents] No project dir, cannot track agent`);
        return;
    }
    // Pre-register expected JSONL file so project scan won't treat it as a /clear file
    const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
    knownJsonlFiles.add(expectedFile);
    // Create agent immediately (before JSONL file exists)
    const id = nextAgentIdRef.current++;
    const folderName = isMultiRoot && cwd ? path.basename(cwd) : undefined;
    const agent = {
        id,
        terminalRef: terminal,
        isExternal: false,
        projectDir,
        jsonlFile: expectedFile,
        fileOffset: 0,
        lineBuffer: '',
        activeToolIds: new Set(),
        activeToolStatuses: new Map(),
        activeToolNames: new Map(),
        activeSubagentToolIds: new Map(),
        activeSubagentToolNames: new Map(),
        isWaiting: false,
        permissionSent: false,
        hadToolsInTurn: false,
        folderName,
    };
    agents.set(id, agent);
    activeAgentIdRef.current = id;
    persistAgents();
    console.log(`[Pixel Agents] Agent ${id}: created for terminal ${terminal.name}`);
    const projectId = path.basename(projectDir);
    webview?.postMessage({ type: 'agentCreated', id, folderName, projectId });
    (0, fileWatcher_js_1.ensureProjectScan)(projectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef, nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview, persistAgents);
    // Poll for the specific JSONL file to appear
    const pollTimer = setInterval(() => {
        try {
            if (fs.existsSync(agent.jsonlFile)) {
                console.log(`[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`);
                clearInterval(pollTimer);
                jsonlPollTimers.delete(id);
                (0, fileWatcher_js_1.startFileWatching)(id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
                (0, fileWatcher_js_1.readNewLines)(id, agents, waitingTimers, permissionTimers, webview);
            }
        }
        catch { /* file may not exist yet */ }
    }, constants_js_1.JSONL_POLL_INTERVAL_MS);
    jsonlPollTimers.set(id, pollTimer);
}
function removeAgent(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents) {
    const agent = agents.get(agentId);
    if (!agent)
        return;
    // Stop JSONL poll timer
    const jpTimer = jsonlPollTimers.get(agentId);
    if (jpTimer) {
        clearInterval(jpTimer);
    }
    jsonlPollTimers.delete(agentId);
    // Stop file watching
    fileWatchers.get(agentId)?.close();
    fileWatchers.delete(agentId);
    const pt = pollingTimers.get(agentId);
    if (pt) {
        clearInterval(pt);
    }
    pollingTimers.delete(agentId);
    try {
        fs.unwatchFile(agent.jsonlFile);
    }
    catch { /* ignore */ }
    // Cancel timers
    (0, timerManager_js_1.cancelWaitingTimer)(agentId, waitingTimers);
    (0, timerManager_js_1.cancelPermissionTimer)(agentId, permissionTimers);
    // Remove from maps
    agents.delete(agentId);
    persistAgents();
}
function persistAgents(agents, context) {
    const persisted = [];
    for (const agent of agents.values()) {
        // Skip external agents — they have no terminal to restore
        if (agent.isExternal || !agent.terminalRef)
            continue;
        persisted.push({
            id: agent.id,
            terminalName: agent.terminalRef.name,
            jsonlFile: agent.jsonlFile,
            projectDir: agent.projectDir,
            folderName: agent.folderName,
            projectId: path.basename(agent.projectDir),
        });
    }
    context.workspaceState.update(constants_js_1.WORKSPACE_KEY_AGENTS, persisted);
}
function restoreAgents(context, nextAgentIdRef, nextTerminalIndexRef, agents, knownJsonlFiles, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, projectScanTimerRef, activeAgentIdRef, webview, doPersist) {
    const persisted = context.workspaceState.get(constants_js_1.WORKSPACE_KEY_AGENTS, []);
    if (persisted.length === 0)
        return;
    const liveTerminals = vscode.window.terminals;
    let maxId = 0;
    let maxIdx = 0;
    let restoredProjectDir = null;
    for (const p of persisted) {
        const terminal = liveTerminals.find(t => t.name === p.terminalName);
        if (!terminal)
            continue;
        const agent = {
            id: p.id,
            terminalRef: terminal,
            isExternal: false,
            projectDir: p.projectDir,
            jsonlFile: p.jsonlFile,
            fileOffset: 0,
            lineBuffer: '',
            activeToolIds: new Set(),
            activeToolStatuses: new Map(),
            activeToolNames: new Map(),
            activeSubagentToolIds: new Map(),
            activeSubagentToolNames: new Map(),
            isWaiting: false,
            permissionSent: false,
            hadToolsInTurn: false,
            folderName: p.folderName,
        };
        agents.set(p.id, agent);
        knownJsonlFiles.add(p.jsonlFile);
        console.log(`[Pixel Agents] Restored agent ${p.id} → terminal "${p.terminalName}"`);
        if (p.id > maxId)
            maxId = p.id;
        // Extract terminal index from name like "Claude Code #3"
        const match = p.terminalName.match(/#(\d+)$/);
        if (match) {
            const idx = parseInt(match[1], 10);
            if (idx > maxIdx)
                maxIdx = idx;
        }
        restoredProjectDir = p.projectDir;
        // Start file watching if JSONL exists, skipping to end of file
        try {
            if (fs.existsSync(p.jsonlFile)) {
                const stat = fs.statSync(p.jsonlFile);
                agent.fileOffset = stat.size;
                (0, fileWatcher_js_1.startFileWatching)(p.id, p.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
            }
            else {
                // Poll for the file to appear
                const pollTimer = setInterval(() => {
                    try {
                        if (fs.existsSync(agent.jsonlFile)) {
                            console.log(`[Pixel Agents] Restored agent ${p.id}: found JSONL file`);
                            clearInterval(pollTimer);
                            jsonlPollTimers.delete(p.id);
                            const stat = fs.statSync(agent.jsonlFile);
                            agent.fileOffset = stat.size;
                            (0, fileWatcher_js_1.startFileWatching)(p.id, agent.jsonlFile, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
                        }
                    }
                    catch { /* file may not exist yet */ }
                }, constants_js_1.JSONL_POLL_INTERVAL_MS);
                jsonlPollTimers.set(p.id, pollTimer);
            }
        }
        catch { /* ignore errors during restore */ }
    }
    // Advance counters past restored IDs
    if (maxId >= nextAgentIdRef.current) {
        nextAgentIdRef.current = maxId + 1;
    }
    if (maxIdx >= nextTerminalIndexRef.current) {
        nextTerminalIndexRef.current = maxIdx + 1;
    }
    // Re-persist cleaned-up list (removes entries whose terminals are gone)
    doPersist();
    // Start project scan for /clear detection
    if (restoredProjectDir) {
        (0, fileWatcher_js_1.ensureProjectScan)(restoredProjectDir, knownJsonlFiles, projectScanTimerRef, activeAgentIdRef, nextAgentIdRef, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview, doPersist);
    }
}
function sendExistingAgents(agents, context, webview) {
    if (!webview)
        return;
    const agentIds = [];
    for (const id of agents.keys()) {
        agentIds.push(id);
    }
    agentIds.sort((a, b) => a - b);
    // Include persisted palette/seatId from separate key
    const agentMeta = context.workspaceState.get(constants_js_1.WORKSPACE_KEY_AGENT_SEATS, {});
    // Include folderName, isExternal, and projectId per agent
    const folderNames = {};
    const externalFlags = {};
    const projectIds = {};
    for (const [id, agent] of agents) {
        if (agent.folderName) {
            folderNames[id] = agent.folderName;
        }
        if (agent.isExternal) {
            externalFlags[id] = true;
        }
        projectIds[id] = path.basename(agent.projectDir);
    }
    console.log(`[Pixel Agents] sendExistingAgents: agents=${JSON.stringify(agentIds)}, meta=${JSON.stringify(agentMeta)}`);
    webview.postMessage({
        type: 'existingAgents',
        agents: agentIds,
        agentMeta,
        folderNames,
        externalFlags,
        projectIds,
    });
    sendCurrentAgentStatuses(agents, webview);
}
function sendCurrentAgentStatuses(agents, webview) {
    if (!webview)
        return;
    for (const [agentId, agent] of agents) {
        // Re-send active tools
        for (const [toolId, status] of agent.activeToolStatuses) {
            webview.postMessage({
                type: 'agentToolStart',
                id: agentId,
                toolId,
                status,
            });
        }
        // Re-send waiting status
        if (agent.isWaiting) {
            webview.postMessage({
                type: 'agentStatus',
                id: agentId,
                status: 'waiting',
            });
        }
    }
}
function sendLayout(context, webview, defaultLayout) {
    if (!webview)
        return;
    const layout = (0, layoutPersistence_js_1.migrateAndLoadLayout)(context, defaultLayout);
    webview.postMessage({
        type: 'layoutLoaded',
        layout,
    });
}
//# sourceMappingURL=agentManager.js.map