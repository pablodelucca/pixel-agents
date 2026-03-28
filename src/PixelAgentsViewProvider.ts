import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  getProjectDirPath,
  launchNewTerminal,
  persistAgents,
  removeAgent,
  restoreAgents,
  sendExistingAgents,
  sendLayout,
} from './agentManager.js';
import type { LoadedAssets } from './assetLoader.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  mergeLoadedAssets,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import {
  GLOBAL_KEY_LAST_SEEN_VERSION,
  GLOBAL_KEY_SOUND_ENABLED,
  LAYOUT_REVISION_KEY,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import { ensureProjectScan } from './fileWatcher.js';
import { HookEventHandler } from './hookEventHandler.js';
import { installHooks } from './hookInstaller.js';
import { HookServer } from './hookServer.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from './layoutPersistence.js';
import type { AgentState } from './types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  nextTerminalIndex = { current: 1 };
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;

  // Per-agent timers
  fileWatchers = new Map<number, fs.FSWatcher>();
  pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // /clear detection: project-level scan for new JSONL files
  activeAgentId = { current: null as number | null };
  knownJsonlFiles = new Set<string>();
  projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

  // Bundled default layout (loaded from assets/default-layout.json)
  defaultLayout: Record<string, unknown> | null = null;

  // Root path of bundled assets (set once on first load)
  private assetsRoot: string | null = null;

  // Cross-window layout sync
  layoutWatcher: LayoutWatcher | null = null;

  // Claude Code Hooks
  private hookServer: HookServer | null = null;
  private hookEventHandler: HookEventHandler | null = null;
  private hooksReady = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.initHooks();
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  private persistAgents = (): void => {
    persistAgents(this.agents, this.context);
  };

  private initHooks(): void {
    this.hookEventHandler = new HookEventHandler(
      this.agents,
      this.waitingTimers,
      this.permissionTimers,
      () => this.webview,
    );

    this.hookServer = new HookServer();
    this.hookServer.onEvent((event) => {
      this.hookEventHandler?.handleEvent(event);
    });

    this.hookServer
      .start()
      .then(() => {
        installHooks();
        this.hooksReady = true;
        // Preemptively mark all existing agents as hook-enabled
        for (const agent of this.agents.values()) {
          agent.hookDelivered = true;
        }
      })
      .catch((e) => {
        console.error(`[Pixel Agents] Failed to start hook server: ${e}`);
      });
  }

  /** Register an agent with the hook event handler for session→agent mapping.
   *  Preemptively sets hookDelivered if the hook infrastructure is ready,
   *  so heuristic timers are suppressed from the start (no first-turn race). */
  registerAgentHook(agent: AgentState): void {
    this.hookEventHandler?.registerAgent(agent.sessionId, agent.id);
    if (this.hooksReady) {
      agent.hookDelivered = true;
    }
  }

  /** Unregister an agent from the hook event handler */
  unregisterAgentHook(agent: AgentState): void {
    this.hookEventHandler?.unregisterAgent(agent.sessionId);
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openClaude') {
        const prevAgentIds = new Set(this.agents.keys());
        await launchNewTerminal(
          this.nextAgentId,
          this.nextTerminalIndex,
          this.agents,
          this.activeAgentId,
          this.knownJsonlFiles,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.projectScanTimer,
          this.webview,
          this.persistAgents,
          message.folderPath as string | undefined,
          message.bypassPermissions as boolean | undefined,
        );
        // Register newly created agent(s) with hook handler
        for (const [id, agent] of this.agents) {
          if (!prevAgentIds.has(id)) {
            this.registerAgentHook(agent);
          }
        }
      } else if (message.type === 'focusAgent') {
        const agent = this.agents.get(message.id);
        if (agent) {
          agent.terminalRef.show();
        }
      } else if (message.type === 'closeAgent') {
        const agent = this.agents.get(message.id);
        if (agent) {
          agent.terminalRef.dispose();
        }
      } else if (message.type === 'saveAgentSeats') {
        // Store seat assignments in a separate key (never touched by persistAgents)
        console.log(`[Pixel Agents] saveAgentSeats:`, JSON.stringify(message.seats));
        this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'setLastSeenVersion') {
        this.context.globalState.update(GLOBAL_KEY_LAST_SEEN_VERSION, message.version as string);
      } else if (message.type === 'webviewReady') {
        restoreAgents(
          this.context,
          this.nextAgentId,
          this.nextTerminalIndex,
          this.agents,
          this.knownJsonlFiles,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.projectScanTimer,
          this.activeAgentId,
          this.webview,
          this.persistAgents,
        );
        // Register all restored agents with hook handler
        for (const agent of this.agents.values()) {
          this.registerAgentHook(agent);
        }
        // Send persisted settings to webview
        const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
        const lastSeenVersion = this.context.globalState.get<string>(
          GLOBAL_KEY_LAST_SEEN_VERSION,
          '',
        );
        const extensionVersion =
          (this.context.extension.packageJSON as { version?: string }).version ?? '';
        const config = readConfig();
        this.webview?.postMessage({
          type: 'settingsLoaded',
          soundEnabled,
          lastSeenVersion,
          extensionVersion,
          externalAssetDirectories: config.externalAssetDirectories,
        });

        // Send workspace folders to webview (only when multi-root)
        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && wsFolders.length > 1) {
          this.webview?.postMessage({
            type: 'workspaceFolders',
            folders: wsFolders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
          });
        }

        // Ensure project scan runs even with no restored agents (to adopt external terminals)
        const projectDir = getProjectDirPath();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        console.log('[Extension] workspaceRoot:', workspaceRoot);
        console.log('[Extension] projectDir:', projectDir);
        ensureProjectScan(
          projectDir,
          this.knownJsonlFiles,
          this.projectScanTimer,
          this.activeAgentId,
          this.nextAgentId,
          this.agents,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.webview,
          this.persistAgents,
          (agent) => this.registerAgentHook(agent),
        );

        // Load furniture assets BEFORE sending layout
        (async () => {
          try {
            console.log('[Extension] Loading furniture assets...');
            const extensionPath = this.extensionUri.fsPath;
            console.log('[Extension] extensionPath:', extensionPath);

            // Check bundled location first: extensionPath/dist/assets/
            const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
            let assetsRoot: string | null = null;
            if (fs.existsSync(bundledAssetsDir)) {
              console.log('[Extension] Found bundled assets at dist/');
              assetsRoot = path.join(extensionPath, 'dist');
            } else if (workspaceRoot) {
              // Fall back to workspace root (development or external assets)
              console.log('[Extension] Trying workspace for assets...');
              assetsRoot = workspaceRoot;
            }

            if (!assetsRoot) {
              console.log('[Extension] ⚠️  No assets directory found');
              if (this.webview) {
                sendLayout(this.context, this.webview, this.defaultLayout);
                this.startLayoutWatcher();
              }
              return;
            }

            console.log('[Extension] Using assetsRoot:', assetsRoot);
            this.assetsRoot = assetsRoot;

            // Load bundled default layout
            this.defaultLayout = loadDefaultLayout(assetsRoot);

            // Load character sprites
            const charSprites = await loadCharacterSprites(assetsRoot);
            if (charSprites && this.webview) {
              console.log('[Extension] Character sprites loaded, sending to webview');
              sendCharacterSpritesToWebview(this.webview, charSprites);
            }

            // Load floor tiles
            const floorTiles = await loadFloorTiles(assetsRoot);
            if (floorTiles && this.webview) {
              console.log('[Extension] Floor tiles loaded, sending to webview');
              sendFloorTilesToWebview(this.webview, floorTiles);
            }

            // Load wall tiles
            const wallTiles = await loadWallTiles(assetsRoot);
            if (wallTiles && this.webview) {
              console.log('[Extension] Wall tiles loaded, sending to webview');
              sendWallTilesToWebview(this.webview, wallTiles);
            }

            const assets = await this.loadAllFurnitureAssets();
            if (assets && this.webview) {
              console.log('[Extension] ✅ Assets loaded, sending to webview');
              sendAssetsToWebview(this.webview, assets);
            }
          } catch (err) {
            console.error('[Extension] ❌ Error loading assets:', err);
          }
          // Always send saved layout (or null for default)
          if (this.webview) {
            console.log('[Extension] Sending saved layout');
            sendLayout(this.context, this.webview, this.defaultLayout);
            this.startLayoutWatcher();
          }
        })();
        sendExistingAgents(this.agents, this.context, this.webview);
      } else if (message.type === 'requestDiagnostics') {
        // Send connection diagnostics for all agents to the Debug View
        const diagnostics: Array<Record<string, unknown>> = [];
        for (const [, agent] of this.agents) {
          let jsonlExists = false;
          let fileSize = 0;
          try {
            const stat = fs.statSync(agent.jsonlFile);
            jsonlExists = true;
            fileSize = stat.size;
          } catch {
            /* file doesn't exist */
          }
          diagnostics.push({
            id: agent.id,
            projectDir: agent.projectDir,
            projectDirExists: fs.existsSync(agent.projectDir),
            jsonlFile: agent.jsonlFile,
            jsonlExists,
            fileSize,
            fileOffset: agent.fileOffset,
            lastDataAt: agent.lastDataAt,
            linesProcessed: agent.linesProcessed,
          });
        }
        this.webview?.postMessage({ type: 'agentDiagnostics', agents: diagnostics });
      } else if (message.type === 'openSessionsFolder') {
        const projectDir = getProjectDirPath();
        if (projectDir && fs.existsSync(projectDir)) {
          vscode.env.openExternal(vscode.Uri.file(projectDir));
        }
      } else if (message.type === 'exportLayout') {
        const layout = readLayoutFromFile();
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
      } else if (message.type === 'addExternalAssetDirectory') {
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel: 'Select Asset Directory',
        });
        if (!uris || uris.length === 0) return;
        const newPath = uris[0].fsPath;
        const cfg = readConfig();
        if (!cfg.externalAssetDirectories.includes(newPath)) {
          cfg.externalAssetDirectories.push(newPath);
          writeConfig(cfg);
        }
        await this.reloadAndSendFurniture();
        this.webview?.postMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: cfg.externalAssetDirectories,
        });
      } else if (message.type === 'removeExternalAssetDirectory') {
        const cfg = readConfig();
        cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter(
          (d) => d !== (message.path as string),
        );
        writeConfig(cfg);
        await this.reloadAndSendFurniture();
        this.webview?.postMessage({
          type: 'externalAssetDirectoriesUpdated',
          dirs: cfg.externalAssetDirectories,
        });
      } else if (message.type === 'importLayout') {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'JSON Files': ['json'] },
          canSelectMany: false,
        });
        if (!uris || uris.length === 0) return;
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
          const imported = JSON.parse(raw) as Record<string, unknown>;
          if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
            vscode.window.showErrorMessage('Pixel Agents: Invalid layout file.');
            return;
          }
          this.layoutWatcher?.markOwnWrite();
          writeLayoutToFile(imported);
          this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
          vscode.window.showInformationMessage('Pixel Agents: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
        }
      }
    });

    vscode.window.onDidChangeActiveTerminal((terminal) => {
      this.activeAgentId.current = null;
      if (!terminal) return;
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef === terminal) {
          this.activeAgentId.current = id;
          webviewView.webview.postMessage({ type: 'agentSelected', id });
          break;
        }
      }
    });

    vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef === closed) {
          if (this.activeAgentId.current === id) {
            this.activeAgentId.current = null;
          }
          this.unregisterAgentHook(agent);
          removeAgent(
            id,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.persistAgents,
          );
          webviewView.webview.postMessage({ type: 'agentClosed', id });
        }
      }
    });
  }

  /** Export current saved layout as a versioned default-layout-{N}.json (dev utility) */
  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
      return;
    }
    const assetsDir = path.join(workspaceRoot, 'webview-ui', 'public', 'assets');

    // Find the next revision number
    let maxRevision = 0;
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) {
          maxRevision = Math.max(maxRevision, parseInt(match[1], 10));
        }
      }
    }
    const nextRevision = maxRevision + 1;
    layout[LAYOUT_REVISION_KEY] = nextRevision;

    const targetPath = path.join(assetsDir, `default-layout-${nextRevision}.json`);
    const json = JSON.stringify(layout, null, 2);
    fs.writeFileSync(targetPath, json, 'utf-8');
    vscode.window.showInformationMessage(
      `Pixel Agents: Default layout exported as revision ${nextRevision} to ${targetPath}`,
    );
  }

  private async loadAllFurnitureAssets(): Promise<LoadedAssets | null> {
    if (!this.assetsRoot) return null;
    let assets = await loadFurnitureAssets(this.assetsRoot);
    const config = readConfig();
    for (const extraDir of config.externalAssetDirectories) {
      console.log('[Extension] Loading external assets from:', extraDir);
      const extra = await loadFurnitureAssets(extraDir);
      if (extra) {
        assets = assets ? mergeLoadedAssets(assets, extra) : extra;
      }
    }
    return assets;
  }

  private async reloadAndSendFurniture(): Promise<void> {
    if (!this.assetsRoot || !this.webview) return;
    try {
      const assets = await this.loadAllFurnitureAssets();
      if (assets) {
        sendAssetsToWebview(this.webview, assets);
      }
    } catch (err) {
      console.error('[Extension] Error reloading furniture assets:', err);
    }
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Pixel Agents] External layout change — pushing to webview');
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  dispose() {
    this.hookServer?.stop();
    this.hookServer = null;
    this.hookEventHandler?.dispose();
    this.hookEventHandler = null;
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    for (const id of [...this.agents.keys()]) {
      removeAgent(
        id,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.persistAgents,
      );
    }
    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }
  }
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
