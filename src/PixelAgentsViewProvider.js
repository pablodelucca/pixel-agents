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
exports.PixelAgentsViewProvider = void 0;
exports.getWebviewContent = getWebviewContent;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const agentManager_js_1 = require("./agentManager.js");
const fileWatcher_js_1 = require("./fileWatcher.js");
const assetLoader_js_1 = require("./assetLoader.js");
const constants_js_1 = require("./constants.js");
const layoutPersistence_js_1 = require("./layoutPersistence.js");
const externalSessionScanner_js_1 = require("./externalSessionScanner.js");
class PixelAgentsViewProvider {
    context;
    nextAgentId = { current: 1 };
    nextTerminalIndex = { current: 1 };
    agents = new Map();
    webviewView;
    // Per-agent timers
    fileWatchers = new Map();
    pollingTimers = new Map();
    waitingTimers = new Map();
    jsonlPollTimers = new Map();
    permissionTimers = new Map();
    // /clear detection: project-level scan for new JSONL files
    activeAgentId = { current: null };
    knownJsonlFiles = new Set();
    projectScanTimer = { current: null };
    // Bundled default layout (loaded from assets/default-layout.json)
    defaultLayout = null;
    // Cross-window layout sync
    layoutWatcher = null;
    // External session detection
    externalScanState = (0, externalSessionScanner_js_1.createExternalScanState)();
    constructor(context) {
        this.context = context;
    }
    get extensionUri() {
        return this.context.extensionUri;
    }
    get webview() {
        return this.webviewView?.webview;
    }
    persistAgents = () => {
        (0, agentManager_js_1.persistAgents)(this.agents, this.context);
    };
    resolveWebviewView(webviewView) {
        this.webviewView = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'openClaude') {
                await (0, agentManager_js_1.launchNewTerminal)(this.nextAgentId, this.nextTerminalIndex, this.agents, this.activeAgentId, this.knownJsonlFiles, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.projectScanTimer, this.webview, this.persistAgents, message.folderPath);
            }
            else if (message.type === 'focusAgent') {
                const agent = this.agents.get(message.id);
                if (agent) {
                    if (agent.isExternal) {
                        vscode.window.showInformationMessage('Pixel Agents: This is an external Claude session (not managed by VS Code).');
                    }
                    else if (agent.terminalRef) {
                        agent.terminalRef.show();
                    }
                }
            }
            else if (message.type === 'closeAgent') {
                const agent = this.agents.get(message.id);
                if (agent) {
                    if (agent.isExternal) {
                        (0, agentManager_js_1.removeAgent)(message.id, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.persistAgents);
                        this.webview?.postMessage({ type: 'agentClosed', id: message.id });
                    }
                    else if (agent.terminalRef) {
                        agent.terminalRef.dispose();
                    }
                }
            }
            else if (message.type === 'saveAgentSeats') {
                // Store seat assignments in a separate key (never touched by persistAgents)
                console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
                this.context.workspaceState.update(constants_js_1.WORKSPACE_KEY_AGENT_SEATS, message.seats);
            }
            else if (message.type === 'saveLayout') {
                this.layoutWatcher?.markOwnWrite();
                (0, layoutPersistence_js_1.writeLayoutToFile)(message.layout);
            }
            else if (message.type === 'setSoundEnabled') {
                this.context.globalState.update(constants_js_1.GLOBAL_KEY_SOUND_ENABLED, message.enabled);
            }
            else if (message.type === 'setShowLabelsAlways') {
                this.context.globalState.update(constants_js_1.GLOBAL_KEY_SHOW_LABELS_ALWAYS, message.enabled);
                this.webview?.postMessage({ type: 'settingChanged', key: 'showLabelsAlways', value: message.enabled });
            }
            else if (message.type === 'webviewReady') {
                (0, agentManager_js_1.restoreAgents)(this.context, this.nextAgentId, this.nextTerminalIndex, this.agents, this.knownJsonlFiles, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.projectScanTimer, this.activeAgentId, this.webview, this.persistAgents);
                // Send persisted settings to webview
                const soundEnabled = this.context.globalState.get(constants_js_1.GLOBAL_KEY_SOUND_ENABLED, true);
                const showLabelsAlways = this.context.globalState.get(constants_js_1.GLOBAL_KEY_SHOW_LABELS_ALWAYS, false);
                const externalSessionsEnabled = vscode.workspace.getConfiguration('pixel-agents').get('externalSessions.enabled', false);
                const externalSessionsScope = vscode.workspace.getConfiguration('pixel-agents').get('externalSessions.scope', 'currentProject');
                this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled, showLabelsAlways, externalSessionsEnabled, externalSessionsScope });
                // Start external session scanning if enabled
                if (externalSessionsEnabled) {
                    this.startExternalSessionScanning();
                }
                // Send workspace folders to webview (only when multi-root)
                const wsFolders = vscode.workspace.workspaceFolders;
                if (wsFolders && wsFolders.length > 1) {
                    this.webview?.postMessage({
                        type: 'workspaceFolders',
                        folders: wsFolders.map(f => ({ name: f.name, path: f.uri.fsPath })),
                    });
                }
                // Ensure project scan runs even with no restored agents (to adopt external terminals)
                const projectDir = (0, agentManager_js_1.getProjectDirPath)();
                const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                console.log('[Extension] workspaceRoot:', workspaceRoot);
                console.log('[Extension] projectDir:', projectDir);
                if (projectDir) {
                    (0, fileWatcher_js_1.ensureProjectScan)(projectDir, this.knownJsonlFiles, this.projectScanTimer, this.activeAgentId, this.nextAgentId, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.webview, this.persistAgents);
                    // Load furniture assets BEFORE sending layout
                    (async () => {
                        try {
                            console.log('[Extension] Loading furniture assets...');
                            const extensionPath = this.extensionUri.fsPath;
                            console.log('[Extension] extensionPath:', extensionPath);
                            // Check bundled location first: extensionPath/dist/assets/
                            const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
                            let assetsRoot = null;
                            if (fs.existsSync(bundledAssetsDir)) {
                                console.log('[Extension] Found bundled assets at dist/');
                                assetsRoot = path.join(extensionPath, 'dist');
                            }
                            else if (workspaceRoot) {
                                // Fall back to workspace root (development or external assets)
                                console.log('[Extension] Trying workspace for assets...');
                                assetsRoot = workspaceRoot;
                            }
                            if (!assetsRoot) {
                                console.log('[Extension] ⚠️  No assets directory found');
                                if (this.webview) {
                                    (0, agentManager_js_1.sendLayout)(this.context, this.webview, this.defaultLayout);
                                    this.startLayoutWatcher();
                                }
                                return;
                            }
                            console.log('[Extension] Using assetsRoot:', assetsRoot);
                            // Load bundled default layout
                            this.defaultLayout = (0, assetLoader_js_1.loadDefaultLayout)(assetsRoot);
                            // Load character sprites
                            const charSprites = await (0, assetLoader_js_1.loadCharacterSprites)(assetsRoot);
                            if (charSprites && this.webview) {
                                console.log('[Extension] Character sprites loaded, sending to webview');
                                (0, assetLoader_js_1.sendCharacterSpritesToWebview)(this.webview, charSprites);
                            }
                            // Load floor tiles
                            const floorTiles = await (0, assetLoader_js_1.loadFloorTiles)(assetsRoot);
                            if (floorTiles && this.webview) {
                                console.log('[Extension] Floor tiles loaded, sending to webview');
                                (0, assetLoader_js_1.sendFloorTilesToWebview)(this.webview, floorTiles);
                            }
                            // Load wall tiles
                            const wallTiles = await (0, assetLoader_js_1.loadWallTiles)(assetsRoot);
                            if (wallTiles && this.webview) {
                                console.log('[Extension] Wall tiles loaded, sending to webview');
                                (0, assetLoader_js_1.sendWallTilesToWebview)(this.webview, wallTiles);
                            }
                            const assets = await (0, assetLoader_js_1.loadFurnitureAssets)(assetsRoot);
                            if (assets && this.webview) {
                                console.log('[Extension] ✅ Assets loaded, sending to webview');
                                (0, assetLoader_js_1.sendAssetsToWebview)(this.webview, assets);
                            }
                        }
                        catch (err) {
                            console.error('[Extension] ❌ Error loading assets:', err);
                        }
                        // Always send saved layout (or null for default)
                        if (this.webview) {
                            console.log('[Extension] Sending saved layout');
                            (0, agentManager_js_1.sendLayout)(this.context, this.webview, this.defaultLayout);
                            this.startLayoutWatcher();
                        }
                    })();
                }
                else {
                    // No project dir — still try to load floor/wall tiles, then send saved layout
                    (async () => {
                        try {
                            const ep = this.extensionUri.fsPath;
                            const bundled = path.join(ep, 'dist', 'assets');
                            if (fs.existsSync(bundled)) {
                                const distRoot = path.join(ep, 'dist');
                                this.defaultLayout = (0, assetLoader_js_1.loadDefaultLayout)(distRoot);
                                const cs = await (0, assetLoader_js_1.loadCharacterSprites)(distRoot);
                                if (cs && this.webview) {
                                    (0, assetLoader_js_1.sendCharacterSpritesToWebview)(this.webview, cs);
                                }
                                const ft = await (0, assetLoader_js_1.loadFloorTiles)(distRoot);
                                if (ft && this.webview) {
                                    (0, assetLoader_js_1.sendFloorTilesToWebview)(this.webview, ft);
                                }
                                const wt = await (0, assetLoader_js_1.loadWallTiles)(distRoot);
                                if (wt && this.webview) {
                                    (0, assetLoader_js_1.sendWallTilesToWebview)(this.webview, wt);
                                }
                            }
                        }
                        catch { /* ignore */ }
                        if (this.webview) {
                            (0, agentManager_js_1.sendLayout)(this.context, this.webview, this.defaultLayout);
                            this.startLayoutWatcher();
                        }
                    })();
                }
                (0, agentManager_js_1.sendExistingAgents)(this.agents, this.context, this.webview);
            }
            else if (message.type === 'setExternalSessionsEnabled') {
                const enabled = !!message.enabled;
                vscode.workspace.getConfiguration('pixel-agents').update('externalSessions.enabled', enabled, vscode.ConfigurationTarget.Global);
                if (enabled) {
                    this.startExternalSessionScanning();
                }
                else {
                    (0, externalSessionScanner_js_1.stopExternalScan)(this.externalScanState, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.persistAgents, this.webview);
                }
            }
            else if (message.type === 'setExternalSessionsScope') {
                const scope = message.scope;
                vscode.workspace.getConfiguration('pixel-agents').update('externalSessions.scope', scope, vscode.ConfigurationTarget.Global);
            }
            else if (message.type === 'openSessionsFolder') {
                const projectDir = (0, agentManager_js_1.getProjectDirPath)();
                if (projectDir && fs.existsSync(projectDir)) {
                    vscode.env.openExternal(vscode.Uri.file(projectDir));
                }
            }
            else if (message.type === 'exportLayout') {
                const layout = (0, layoutPersistence_js_1.readLayoutFromFile)();
                if (!layout) {
                    vscode.window.showWarningMessage('Pixel Agents: No saved layout to export.');
                    return;
                }
                const uri = await vscode.window.showSaveDialog({
                    filters: { 'JSON Files': ['json'] },
                    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixel-agents-layout.json')),
                });
                if (uri) {
                    fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
                    vscode.window.showInformationMessage('Pixel Agents: Layout exported successfully.');
                }
            }
            else if (message.type === 'importLayout') {
                const uris = await vscode.window.showOpenDialog({
                    filters: { 'JSON Files': ['json'] },
                    canSelectMany: false,
                });
                if (!uris || uris.length === 0)
                    return;
                try {
                    const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
                    const imported = JSON.parse(raw);
                    if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
                        vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
                        return;
                    }
                    this.layoutWatcher?.markOwnWrite();
                    (0, layoutPersistence_js_1.writeLayoutToFile)(imported);
                    this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
                    vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
                }
                catch {
                    vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
                }
            }
        });
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('pixel-agents.externalSessions.enabled')) {
                const enabled = vscode.workspace.getConfiguration('pixel-agents').get('externalSessions.enabled', false);
                if (enabled) {
                    this.startExternalSessionScanning();
                }
                else {
                    (0, externalSessionScanner_js_1.stopExternalScan)(this.externalScanState, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.persistAgents, this.webview);
                }
                this.webview?.postMessage({ type: 'settingChanged', key: 'externalSessionsEnabled', value: enabled });
            }
            if (e.affectsConfiguration('pixel-agents.externalSessions.scope')) {
                const scope = vscode.workspace.getConfiguration('pixel-agents').get('externalSessions.scope', 'currentProject');
                this.webview?.postMessage({ type: 'settingChanged', key: 'externalSessionsScope', value: scope });
            }
        });
        vscode.window.onDidChangeActiveTerminal((terminal) => {
            this.activeAgentId.current = null;
            if (!terminal)
                return;
            for (const [id, agent] of this.agents) {
                if (!agent.isExternal && agent.terminalRef === terminal) {
                    this.activeAgentId.current = id;
                    webviewView.webview.postMessage({ type: 'agentSelected', id });
                    break;
                }
            }
        });
        vscode.window.onDidCloseTerminal((closed) => {
            for (const [id, agent] of this.agents) {
                if (!agent.isExternal && agent.terminalRef === closed) {
                    if (this.activeAgentId.current === id) {
                        this.activeAgentId.current = null;
                    }
                    (0, agentManager_js_1.removeAgent)(id, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.persistAgents);
                    webviewView.webview.postMessage({ type: 'agentClosed', id });
                }
            }
        });
    }
    /** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
    exportDefaultLayout() {
        const layout = (0, layoutPersistence_js_1.readLayoutFromFile)();
        if (!layout) {
            vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
            return;
        }
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
            return;
        }
        const targetPath = path.join(workspaceRoot, 'webview-ui', 'public', 'assets', 'default-layout.json');
        const json = JSON.stringify(layout, null, 2);
        fs.writeFileSync(targetPath, json, 'utf-8');
        vscode.window.showInformationMessage(`Pixel Agents: Default layout exported to ${targetPath}`);
    }
    startExternalSessionScanning() {
        (0, externalSessionScanner_js_1.startExternalScan)(this.externalScanState, this.agents, this.knownJsonlFiles, this.nextAgentId, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.persistAgents, this.webview);
    }
    startLayoutWatcher() {
        if (this.layoutWatcher)
            return;
        this.layoutWatcher = (0, layoutPersistence_js_1.watchLayoutFile)((layout) => {
            console.log('[Pixel Agents] External layout change — pushing to webview');
            this.webview?.postMessage({ type: 'layoutLoaded', layout });
        });
    }
    dispose() {
        (0, externalSessionScanner_js_1.stopExternalScan)(this.externalScanState, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.persistAgents, this.webview);
        this.layoutWatcher?.dispose();
        this.layoutWatcher = null;
        for (const id of [...this.agents.keys()]) {
            (0, agentManager_js_1.removeAgent)(id, this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers, this.jsonlPollTimers, this.persistAgents);
        }
        if (this.projectScanTimer.current) {
            clearInterval(this.projectScanTimer.current);
            this.projectScanTimer.current = null;
        }
    }
}
exports.PixelAgentsViewProvider = PixelAgentsViewProvider;
function getWebviewContent(webview, extensionUri) {
    const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
    const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;
    let html = fs.readFileSync(indexPath, 'utf-8');
    html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
        const fileUri = vscode.Uri.joinPath(distPath, filePath);
        const webviewUri = webview.asWebviewUri(fileUri);
        return `${attr}="${webviewUri}"`;
    });
    return html;
}
//# sourceMappingURL=PixelAgentsViewProvider.js.map