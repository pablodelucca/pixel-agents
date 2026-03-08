import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { computeAgentStates } from './agentStateMapper.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import { GLOBAL_KEY_SOUND_ENABLED } from './constants.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import {
  migrateAndLoadLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from './layoutPersistence.js';
import type { LogTailerState } from './logTailer.js';
import { disposeLogTailer, startLogTailer } from './logTailer.js';
import type { ProcessStatusMap } from './processDetector.js';
import { detectProcesses, PROCESS_POLL_INTERVAL_MS } from './processDetector.js';
import type { TriggerWatcherState } from './triggerWatcher.js';
import { disposeTriggerWatcher, startTriggerWatcher } from './triggerWatcher.js';
import type { WholesaleStateSnapshot } from './types.js';
import { WHOLESALE_AGENTS } from './types.js';
import {
  createEmptyDbSnapshot,
  DB_POLL_INTERVAL_MS,
  disposeDataPoller,
  initDataPoller,
  pollDatabase,
} from './wholesaleDataPoller.js';

/** Wholesale directory path — configurable, defaults to ~/Desktop/wholesale */
function getWholesaleDir(): string {
  const config = vscode.workspace.getConfiguration('wholesale-agents');
  return config.get<string>('wholesaleDir') || path.join(os.homedir(), 'Desktop', 'wholesale');
}

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  webviewView: vscode.WebviewView | undefined;

  // Bundled default layout
  defaultLayout: Record<string, unknown> | null = null;

  // Cross-window layout sync
  layoutWatcher: LayoutWatcher | null = null;

  // ── Wholesale data sources ──────────────────────────────
  private wholesaleDir: string;
  private dbPollTimer: ReturnType<typeof setInterval> | null = null;
  private processPollTimer: ReturnType<typeof setInterval> | null = null;
  private triggerState: TriggerWatcherState | null = null;
  private logState: LogTailerState | null = null;
  private processStatuses: ProcessStatusMap = {
    1: 'not_running',
    2: 'not_running',
    3: 'not_running',
  };
  private lastSnapshot: WholesaleStateSnapshot | null = null;
  private dbReady = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.wholesaleDir = getWholesaleDir();
  }

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'webviewReady') {
        // Send persisted settings to webview
        const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
        this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled });

        // Load and send assets, then layout
        await this.loadAndSendAssets();

        // Send fixed wholesale agents to webview
        this.sendWholesaleAgents();

        // Start wholesale data sources
        await this.startWholesalePolling();
      } else if (message.type === 'exportLayout') {
        const layout = readLayoutFromFile();
        if (!layout) {
          vscode.window.showWarningMessage('Wholesale Agents: No saved layout to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'] },
          defaultUri: vscode.Uri.file(path.join(os.homedir(), 'wholesale-agents-layout.json')),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
          vscode.window.showInformationMessage('Wholesale Agents: Layout exported successfully.');
        }
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
            vscode.window.showErrorMessage('Wholesale Agents: Invalid layout file.');
            return;
          }
          this.layoutWatcher?.markOwnWrite();
          writeLayoutToFile(imported);
          this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
          vscode.window.showInformationMessage('Wholesale Agents: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('Wholesale Agents: Failed to read or parse layout file.');
        }
      }
    });
  }

  /** Send the 3 fixed wholesale agents to the webview */
  private sendWholesaleAgents(): void {
    const agents = Object.values(WHOLESALE_AGENTS).map((a) => a.id);
    const agentMeta: Record<number, { palette: number; hueShift: number; name: string }> = {};
    for (const a of Object.values(WHOLESALE_AGENTS)) {
      agentMeta[a.id] = { palette: a.palette, hueShift: 0, name: a.name };
    }
    this.webview?.postMessage({
      type: 'wholesaleAgents',
      agents,
      agentMeta,
    });
  }

  /** Load and send all assets, then layout */
  private async loadAndSendAssets(): Promise<void> {
    try {
      const extensionPath = this.extensionUri.fsPath;
      const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      let assetsRoot: string | null = null;

      if (fs.existsSync(bundledAssetsDir)) {
        assetsRoot = path.join(extensionPath, 'dist');
      } else if (workspaceRoot) {
        assetsRoot = workspaceRoot;
      }

      if (assetsRoot) {
        this.defaultLayout = loadDefaultLayout(assetsRoot);

        const charSprites = await loadCharacterSprites(assetsRoot);
        if (charSprites && this.webview) {
          sendCharacterSpritesToWebview(this.webview, charSprites);
        }

        const floorTiles = await loadFloorTiles(assetsRoot);
        if (floorTiles && this.webview) {
          sendFloorTilesToWebview(this.webview, floorTiles);
        }

        const wallTiles = await loadWallTiles(assetsRoot);
        if (wallTiles && this.webview) {
          sendWallTilesToWebview(this.webview, wallTiles);
        }

        const assets = await loadFurnitureAssets(assetsRoot);
        if (assets && this.webview) {
          sendAssetsToWebview(this.webview, assets);
        }
      }
    } catch (err) {
      console.error('[Wholesale Agents] Error loading assets:', err);
    }

    // Send layout
    if (this.webview) {
      const layout = migrateAndLoadLayout(this.context, this.defaultLayout);
      this.webview.postMessage({ type: 'layoutLoaded', layout });
      this.startLayoutWatcher();
    }
  }

  /** Start all wholesale data polling */
  private async startWholesalePolling(): Promise<void> {
    // Init SQLite
    this.dbReady = await initDataPoller();
    if (!this.dbReady) {
      console.warn('[Wholesale Agents] SQLite not available — DB polling disabled');
    }

    // Initial state push
    this.updateAndPushState();

    // DB poller (every 5s)
    this.dbPollTimer = setInterval(() => {
      this.updateAndPushState();
    }, DB_POLL_INTERVAL_MS);

    // Process detector (every 10s)
    this.processStatuses = detectProcesses();
    this.processPollTimer = setInterval(() => {
      this.processStatuses = detectProcesses();
    }, PROCESS_POLL_INTERVAL_MS);

    // Trigger watcher
    this.triggerState = startTriggerWatcher(this.wholesaleDir, () => {
      // On new trigger, do an immediate state update
      this.updateAndPushState();
    });

    // Log tailer
    this.logState = startLogTailer(this.wholesaleDir);
  }

  /** Compute full state snapshot and push to webview */
  private updateAndPushState(): void {
    const db = this.dbReady ? pollDatabase(this.wholesaleDir) : createEmptyDbSnapshot();
    const snapshot = computeAgentStates(
      this.processStatuses,
      db,
      this.triggerState ?? {
        watcher: null,
        pollTimer: null,
        recentTriggers: [],
        seenFiles: new Set(),
      },
      this.logState ?? { files: new Map(), pollTimer: null, recentEvents: [] },
    );
    this.lastSnapshot = snapshot;
    this.webview?.postMessage({ type: 'wholesaleState', snapshot });
  }

  /** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('Wholesale Agents: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Wholesale Agents: No workspace folder found.');
      return;
    }
    const targetPath = path.join(
      workspaceRoot,
      'webview-ui',
      'public',
      'assets',
      'default-layout.json',
    );
    const json = JSON.stringify(layout, null, 2);
    fs.writeFileSync(targetPath, json, 'utf-8');
    vscode.window.showInformationMessage(
      `Wholesale Agents: Default layout exported to ${targetPath}`,
    );
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Wholesale Agents] External layout change — pushing to webview');
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  dispose() {
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;

    if (this.dbPollTimer) {
      clearInterval(this.dbPollTimer);
      this.dbPollTimer = null;
    }
    if (this.processPollTimer) {
      clearInterval(this.processPollTimer);
      this.processPollTimer = null;
    }
    if (this.triggerState) {
      disposeTriggerWatcher(this.triggerState);
      this.triggerState = null;
    }
    if (this.logState) {
      disposeLogTailer(this.logState);
      this.logState = null;
    }
    disposeDataPoller();
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
