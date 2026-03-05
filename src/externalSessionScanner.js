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
exports.createExternalScanState = createExternalScanState;
exports.startExternalScan = startExternalScan;
exports.stopExternalScan = stopExternalScan;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const vscode = __importStar(require("vscode"));
const fileWatcher_js_1 = require("./fileWatcher.js");
const constants_js_1 = require("./constants.js");
const agentManager_js_1 = require("./agentManager.js");
const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
function createExternalScanState() {
    return { timer: null, trackedFiles: new Map() };
}
function startExternalScan(scanState, agents, knownJsonlFiles, nextAgentIdRef, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents, webview) {
    if (scanState.timer)
        return;
    console.log('[Pixel Agents] Starting external session scanner');
    // Run immediately, then on interval
    runExternalScan(scanState, agents, knownJsonlFiles, nextAgentIdRef, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents, webview);
    scanState.timer = setInterval(() => {
        runExternalScan(scanState, agents, knownJsonlFiles, nextAgentIdRef, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents, webview);
    }, constants_js_1.EXTERNAL_SESSION_SCAN_INTERVAL_MS);
}
function stopExternalScan(scanState, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents, webview) {
    if (scanState.timer) {
        clearInterval(scanState.timer);
        scanState.timer = null;
    }
    // Remove all external agents
    for (const [filePath, agentId] of scanState.trackedFiles) {
        (0, agentManager_js_1.removeAgent)(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
        webview?.postMessage({ type: 'agentClosed', id: agentId });
    }
    scanState.trackedFiles.clear();
    console.log('[Pixel Agents] External session scanner stopped');
}
function runExternalScan(scanState, agents, knownJsonlFiles, nextAgentIdRef, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents, webview) {
    const scope = vscode.workspace.getConfiguration('pixel-agents').get('externalSessions.scope', 'currentProject');
    const now = Date.now();
    // Collect directories to scan
    const dirsToScan = [];
    if (scope === 'allProjects') {
        try {
            const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    dirsToScan.push(path.join(claudeProjectsDir, entry.name));
                }
            }
        }
        catch { /* ~/.claude/projects may not exist */ }
    }
    else {
        // Current project only
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspacePath) {
            const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
            const projectDir = path.join(claudeProjectsDir, dirName);
            dirsToScan.push(projectDir);
        }
    }
    // Find active JSONL files
    const activeFiles = new Set();
    for (const dir of dirsToScan) {
        try {
            const files = fs.readdirSync(dir)
                .filter(f => f.endsWith('.jsonl'))
                .map(f => path.join(dir, f));
            for (const file of files) {
                // Skip files already tracked by the extension (non-external agents)
                if (knownJsonlFiles.has(file))
                    continue;
                try {
                    const stat = fs.statSync(file);
                    const age = now - stat.mtimeMs;
                    if (age < constants_js_1.EXTERNAL_SESSION_STALE_THRESHOLD_MS) {
                        activeFiles.add(file);
                        // Not yet tracked as external → create agent
                        if (!scanState.trackedFiles.has(file)) {
                            const id = nextAgentIdRef.current++;
                            const projectDir = path.dirname(file);
                            // Derive a readable folder name from the project dir name
                            // Dir name is the workspace path with : \ / replaced by -
                            const dirBaseName = path.basename(projectDir);
                            const decodedPath = dirBaseName.replace(/^-/, '/').replace(/-/g, '/');
                            const home = os.homedir();
                            const folderName = decodedPath.startsWith(home)
                                ? decodedPath.slice(home.length + 1)
                                : decodedPath;
                            const agent = {
                                id,
                                isExternal: true,
                                projectDir,
                                jsonlFile: file,
                                fileOffset: stat.size, // Skip past history
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
                            scanState.trackedFiles.set(file, id);
                            console.log(`[Pixel Agents] External agent ${id}: tracking ${path.basename(file)}`);
                            const projectId = path.basename(projectDir);
                            webview?.postMessage({ type: 'agentCreated', id, isExternal: true, folderName, projectId });
                            // Start file watching to track tool activity
                            (0, fileWatcher_js_1.startFileWatching)(id, file, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, webview);
                            (0, fileWatcher_js_1.readNewLines)(id, agents, waitingTimers, permissionTimers, webview);
                        }
                    }
                    else if (age > constants_js_1.EXTERNAL_SESSION_REMOVE_THRESHOLD_MS) {
                        // Stale beyond remove threshold — remove if tracked
                        const trackedId = scanState.trackedFiles.get(file);
                        if (trackedId !== undefined) {
                            console.log(`[Pixel Agents] External agent ${trackedId}: removing stale session`);
                            (0, agentManager_js_1.removeAgent)(trackedId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
                            webview?.postMessage({ type: 'agentClosed', id: trackedId });
                            scanState.trackedFiles.delete(file);
                        }
                    }
                }
                catch { /* stat error, skip file */ }
            }
        }
        catch { /* dir read error, skip */ }
    }
    // Remove agents for files that no longer exist or have gone stale
    for (const [filePath, agentId] of scanState.trackedFiles) {
        if (!activeFiles.has(filePath)) {
            try {
                const stat = fs.statSync(filePath);
                const age = now - stat.mtimeMs;
                if (age > constants_js_1.EXTERNAL_SESSION_REMOVE_THRESHOLD_MS) {
                    console.log(`[Pixel Agents] External agent ${agentId}: session gone stale, removing`);
                    (0, agentManager_js_1.removeAgent)(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
                    webview?.postMessage({ type: 'agentClosed', id: agentId });
                    scanState.trackedFiles.delete(filePath);
                }
            }
            catch {
                // File no longer exists
                console.log(`[Pixel Agents] External agent ${agentId}: file gone, removing`);
                (0, agentManager_js_1.removeAgent)(agentId, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
                webview?.postMessage({ type: 'agentClosed', id: agentId });
                scanState.trackedFiles.delete(filePath);
            }
        }
    }
}
//# sourceMappingURL=externalSessionScanner.js.map