import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { HookEvent } from '../server/src/hookEventHandler.js';
import { HookEventHandler } from '../server/src/hookEventHandler.js';
import {
  copyHookScript,
  installHooks,
  uninstallHooks,
} from '../server/src/providers/file/codexHookInstaller.js';
import { PixelAgentsServer } from '../server/src/server.js';
import type { MissionControlTask } from '../shared/missionControl.js';
import {
  getProjectDirPath,
  launchNewTerminal,
  persistAgents,
  removeAgent,
  restoreAgents,
  sendCurrentAgentStatuses,
  sendExistingAgents,
  sendLayout,
} from './agentManager.js';
import type { LoadedAssets, LoadedCharacterSprites } from './assetLoader.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadExternalCharacterSprites,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  mergeCharacterSprites,
  mergeLoadedAssets,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import { readConfig, writeConfig } from './configPersistence.js';
import {
  GLOBAL_KEY_ALWAYS_SHOW_LABELS,
  GLOBAL_KEY_HOOKS_ENABLED,
  GLOBAL_KEY_HOOKS_INFO_SHOWN,
  GLOBAL_KEY_LAST_SEEN_VERSION,
  GLOBAL_KEY_SOUND_ENABLED,
  GLOBAL_KEY_WATCH_ALL_SESSIONS,
  LAYOUT_REVISION_KEY,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from './layoutPersistence.js';
import { MissionControlStore } from './missionControlStore.js';
import { safeUpdateState } from './stateUtils.js';
import type { AgentState } from './types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  nextTerminalIndex = { current: 1 };
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;

  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  activeAgentId = { current: null as number | null };

  watchAllSessions = { current: false };
  hooksEnabled = { current: true };

  defaultLayout: Record<string, unknown> | null = null;
  private assetsRoot: string | null = null;
  layoutWatcher: LayoutWatcher | null = null;

  private pixelAgentsServer: PixelAgentsServer | null = null;
  private hookEventHandler: HookEventHandler | null = null;
  private missionControlStore: MissionControlStore;
  private missionControlUnsubscribe: (() => void) | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.missionControlStore = new MissionControlStore(context);
    this.missionControlUnsubscribe = this.missionControlStore.subscribe((snapshot) => {
      this.webview?.postMessage({ type: 'missionControlSnapshot', snapshot });
    });
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

  private buildTaskDispatchPrompt(task: MissionControlTask): string {
    const parts = [`Mission Control task: ${task.goal.trim()}`];

    if (task.constraints.length > 0) {
      parts.push(`Constraints: ${task.constraints.join('; ')}`);
    }

    if (task.acceptanceCriteria.length > 0) {
      parts.push(`Acceptance criteria: ${task.acceptanceCriteria.join('; ')}`);
    }

    if (task.expectedArtifacts.length > 0) {
      parts.push(`Expected artifacts: ${task.expectedArtifacts.join('; ')}`);
    }

    parts.push('If blocked, state the blocker and the smallest next input or approval needed.');

    return parts.join(' | ');
  }

  private focusAgentTerminal(agentId: number, options?: { recordTakeover?: boolean }): void {
    const agent = this.agents.get(agentId);
    if (!agent?.terminalRef) return;
    agent.terminalRef.show();
    if (options?.recordTakeover) {
      this.missionControlStore.recordTakeover(agent);
    }
  }

  private async interruptAgent(agentId: number): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent?.terminalRef) {
      void vscode.window.showWarningMessage(
        'Mission Control: This session cannot be interrupted from the extension.',
      );
      return;
    }

    agent.terminalRef.show();
    await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', {
      text: '\u0003',
    });
    this.missionControlStore.recordInterrupt(agent);
  }

  private initHooks(): void {
    this.hookEventHandler = new HookEventHandler(
      this.agents,
      this.waitingTimers,
      this.permissionTimers,
      () => this.webview,
      this.watchAllSessions,
    );

    this.hookEventHandler.setLifecycleCallbacks({
      onExternalSessionDetected: (_sessionId, _transcriptPath, _cwd) => {
        // Adopt logic without file scanning
      },
      onSessionClear: (agentId, newSessionId, _newTranscriptPath) => {
        const agent = this.agents.get(agentId);
        if (agent) {
          this.unregisterAgentHook(agent);
          agent.sessionId = newSessionId;
          this.registerAgentHook(agent);
        }
      },
      onSessionResume: (_transcriptPath) => {},
      onSessionEnd: (agentId) => {
        const agent = this.agents.get(agentId);
        if (!agent) return;
        if (agent.isExternal) {
          this.missionControlStore.recordAgentRemoved(agent, 'External session ended');
          this.unregisterAgentHook(agent);
          removeAgent(
            agentId,
            this.agents,
            this.waitingTimers,
            this.permissionTimers,
            this.persistAgents,
          );
          this.webview?.postMessage({ type: 'agentClosed', id: agentId });
        }
      },
      onHookEvent: (agentId, providerId, event, agent) => {
        const trackedAgent = this.agents.get(agentId) ?? agent;
        this.missionControlStore.handleHookEvent(trackedAgent, providerId, event);
      },
    });

    this.pixelAgentsServer = new PixelAgentsServer();
    this.pixelAgentsServer.onHookEvent((providerId, event) => {
      this.hookEventHandler?.handleEvent(providerId, event as HookEvent);
    });

    this.pixelAgentsServer
      .start()
      .then((config) => {
        const hooksEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_HOOKS_ENABLED, true);
        this.hooksEnabled.current = hooksEnabled;
        if (hooksEnabled) {
          installHooks();
          copyHookScript(this.context.extensionPath);
        }
        console.log(`[Pixel Agents] Server: ready on port ${config.port}`);
      })
      .catch((e) => {
        console.error(`[Pixel Agents] Failed to start server: ${e}`);
      });
  }

  registerAgentHook(agent: AgentState): void {
    this.hookEventHandler?.registerAgent(agent.sessionId, agent.id);
  }

  unregisterAgentHook(agent: AgentState): void {
    this.hookEventHandler?.unregisterAgent(agent.sessionId);
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openCodex') {
        const prevAgentIds = new Set(this.agents.keys());
        await launchNewTerminal(
          this.nextAgentId,
          this.nextTerminalIndex,
          this.agents,
          this.webview,
          this.persistAgents,
          message.folderPath as string | undefined,
          message.bypassPermissions as boolean | undefined,
        );
        for (const [id, agent] of this.agents) {
          if (!prevAgentIds.has(id)) {
            this.registerAgentHook(agent);
            this.missionControlStore.recordAgentLaunch(agent);
          }
        }
      } else if (message.type === 'focusAgent') {
        this.focusAgentTerminal(message.id as number);
      } else if (message.type === 'openAgentTerminal') {
        this.focusAgentTerminal(message.id as number, { recordTakeover: true });
      } else if (message.type === 'interruptAgent') {
        await this.interruptAgent(message.id as number);
      } else if (message.type === 'createMissionTask') {
        this.missionControlStore.createTask({
          title: message.title as string | undefined,
          goal: message.goal as string,
          priority: message.priority as MissionControlTask['priority'] | undefined,
          acceptanceCriteria: (message.acceptanceCriteria as string[] | undefined) ?? [],
          constraints: (message.constraints as string[] | undefined) ?? [],
          expectedArtifacts: (message.expectedArtifacts as string[] | undefined) ?? [],
        });
      } else if (message.type === 'submitMissionTask') {
        const agent = this.agents.get(message.agentId as number);
        if (!agent) {
          void vscode.window.showWarningMessage('Mission Control: Agent not found.');
          return;
        }
        if (!agent.terminalRef) {
          void vscode.window.showWarningMessage(
            'Mission Control: External sessions can be inspected but not dispatched from this window.',
          );
          return;
        }
        const task = this.missionControlStore.submitTask(
          {
            title: message.title as string | undefined,
            goal: message.goal as string,
            priority: message.priority as MissionControlTask['priority'] | undefined,
            acceptanceCriteria: (message.acceptanceCriteria as string[] | undefined) ?? [],
            constraints: (message.constraints as string[] | undefined) ?? [],
            expectedArtifacts: (message.expectedArtifacts as string[] | undefined) ?? [],
          },
          agent,
        );
        if (!task) {
          void vscode.window.showWarningMessage('Mission Control: Failed to create task.');
          return;
        }
        agent.terminalRef.show();
        agent.terminalRef.sendText(this.buildTaskDispatchPrompt(task), true);
      } else if (message.type === 'assignMissionTask') {
        const agent = this.agents.get(message.agentId as number);
        if (!agent) {
          void vscode.window.showWarningMessage('Mission Control: Agent not found.');
          return;
        }
        if (!agent.terminalRef) {
          void vscode.window.showWarningMessage(
            'Mission Control: External sessions can be inspected but not dispatched from this window.',
          );
          return;
        }
        const task = this.missionControlStore.assignTask(message.taskId as string, agent);
        if (!task) {
          void vscode.window.showWarningMessage('Mission Control: Task not found.');
          return;
        }
        agent.terminalRef.show();
        agent.terminalRef.sendText(this.buildTaskDispatchPrompt(task), true);
      } else if (message.type === 'updateMissionTaskStatus') {
        this.missionControlStore.updateTaskStatus(
          message.taskId as string,
          message.status as MissionControlTask['status'],
          message.latestUpdate as string | undefined,
        );
      } else if (message.type === 'resolveApprovalRequest') {
        this.missionControlStore.resolveApproval(
          message.approvalId as string,
          message.status as 'approved' | 'rejected',
          message.decisionSummary as string | undefined,
        );
      } else if (message.type === 'closeAgent') {
        const agent = this.agents.get(message.id);
        if (agent) {
          if (agent.terminalRef) {
            agent.terminalRef.dispose();
          } else {
            this.missionControlStore.recordAgentRemoved(agent, 'Agent closed from Mission Control');
            removeAgent(
              message.id,
              this.agents,
              this.waitingTimers,
              this.permissionTimers,
              this.persistAgents,
            );
            webviewView.webview.postMessage({ type: 'agentClosed', id: message.id });
          }
        }
      } else if (message.type === 'saveAgentSeats') {
        console.log(`[Pixel Agents] State: saveAgentSeats:`, JSON.stringify(message.seats));
        safeUpdateState(this.context.workspaceState, WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        safeUpdateState(this.context.globalState, GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'setLastSeenVersion') {
        safeUpdateState(
          this.context.globalState,
          GLOBAL_KEY_LAST_SEEN_VERSION,
          message.version as string,
        );
      } else if (message.type === 'setAlwaysShowLabels') {
        safeUpdateState(this.context.globalState, GLOBAL_KEY_ALWAYS_SHOW_LABELS, message.enabled);
      } else if (message.type === 'setHooksEnabled') {
        const enabled = message.enabled as boolean;
        safeUpdateState(this.context.globalState, GLOBAL_KEY_HOOKS_ENABLED, enabled);
        this.hooksEnabled.current = enabled;
        if (enabled) {
          installHooks();
          copyHookScript(this.context.extensionPath);
          console.log('[Pixel Agents] Hooks enabled by user');
        } else {
          uninstallHooks();
          console.log('[Pixel Agents] Hooks disabled by user');
        }
      } else if (message.type === 'setHooksInfoShown') {
        safeUpdateState(this.context.globalState, GLOBAL_KEY_HOOKS_INFO_SHOWN, true);
      } else if (message.type === 'setWatchAllSessions') {
        const enabled = message.enabled as boolean;
        safeUpdateState(this.context.globalState, GLOBAL_KEY_WATCH_ALL_SESSIONS, enabled);
        this.watchAllSessions.current = enabled;
        if (!enabled) {
          const workspaceDirs = new Set<string>();
          for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const dir = getProjectDirPath(folder.uri.fsPath);
            if (dir) workspaceDirs.add(dir);
          }
          const toRemove: number[] = [];
          for (const [id, agent] of this.agents) {
            if (agent.isExternal && !workspaceDirs.has(agent.projectDir)) {
              toRemove.push(id);
            }
          }
          for (const id of toRemove) {
            const agent = this.agents.get(id);
            if (agent) {
              this.missionControlStore.recordAgentRemoved(
                agent,
                'Removed after Watch All Sessions was disabled',
              );
            }
            removeAgent(
              id,
              this.agents,
              this.waitingTimers,
              this.permissionTimers,
              this.persistAgents,
            );
            this.webview?.postMessage({ type: 'agentClosed', id });
          }
        }
      } else if (message.type === 'webviewReady') {
        this.missionControlStore.hydrate(this.agents.values());
        restoreAgents(
          this.context,
          this.nextAgentId,
          this.nextTerminalIndex,
          this.agents,
          this.persistAgents,
        );
        for (const agent of this.agents.values()) {
          this.registerAgentHook(agent);
        }
        this.missionControlStore.syncAgents(this.agents.values());
        const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
        const lastSeenVersion = this.context.globalState.get<string>(
          GLOBAL_KEY_LAST_SEEN_VERSION,
          '',
        );
        const extensionVersion =
          (this.context.extension.packageJSON as { version?: string }).version ?? '';
        const watchAllSessions = this.context.globalState.get<boolean>(
          GLOBAL_KEY_WATCH_ALL_SESSIONS,
          false,
        );
        const alwaysShowLabels = this.context.globalState.get<boolean>(
          GLOBAL_KEY_ALWAYS_SHOW_LABELS,
          false,
        );
        this.watchAllSessions.current = watchAllSessions;
        const hooksEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_HOOKS_ENABLED, true);
        const hooksInfoShown = this.context.globalState.get<boolean>(
          GLOBAL_KEY_HOOKS_INFO_SHOWN,
          false,
        );
        const config = readConfig();
        this.webview?.postMessage({
          type: 'settingsLoaded',
          soundEnabled,
          lastSeenVersion,
          extensionVersion,
          watchAllSessions,
          alwaysShowLabels,
          hooksEnabled,
          hooksInfoShown,
          externalAssetDirectories: config.externalAssetDirectories,
        });

        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && wsFolders.length > 0) {
          this.webview?.postMessage({
            type: 'workspaceFolders',
            folders: wsFolders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
          });
        }

        (async () => {
          try {
            console.log('[Extension] Loading furniture assets...');
            const extensionPath = this.extensionUri.fsPath;

            const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
            let assetsRoot: string | null = null;
            if (fs.existsSync(bundledAssetsDir)) {
              assetsRoot = path.join(extensionPath, 'dist');
            } else if (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) {
              assetsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            }

            if (!assetsRoot) {
              if (this.webview) {
                sendLayout(this.context, this.webview, this.defaultLayout);
                sendCurrentAgentStatuses(this.agents, this.webview);
                this.startLayoutWatcher();
              }
              return;
            }

            this.assetsRoot = assetsRoot;
            this.defaultLayout = loadDefaultLayout(assetsRoot);

            const charSprites = await this.loadAllCharacterSprites();
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

            const assets = await this.loadAllFurnitureAssets();
            if (assets && this.webview) {
              sendAssetsToWebview(this.webview, assets);
            }
          } catch (err) {
            console.error('[Extension] ❌ Error loading assets:', err);
          }
          if (this.webview) {
            sendLayout(this.context, this.webview, this.defaultLayout);
            sendCurrentAgentStatuses(this.agents, this.webview);
            this.startLayoutWatcher();
          }
        })();
        sendExistingAgents(this.agents, this.context, this.webview);
        this.webview?.postMessage({
          type: 'missionControlSnapshot',
          snapshot: this.missionControlStore.getSnapshot(),
        });
      } else if (message.type === 'requestDiagnostics') {
        const diagnostics: Array<Record<string, unknown>> = [];
        for (const [, agent] of this.agents) {
          diagnostics.push({
            id: agent.id,
            projectDir: agent.projectDir,
            projectDirExists: fs.existsSync(agent.projectDir),
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
        await this.reloadAndSendCharacters();
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
        await this.reloadAndSendCharacters();
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
        if (agent.terminalRef && agent.terminalRef === terminal) {
          this.activeAgentId.current = id;
          webviewView.webview.postMessage({ type: 'agentSelected', id });
          break;
        }
      }
    });

    vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef && agent.terminalRef === closed) {
          if (this.activeAgentId.current === id) {
            this.activeAgentId.current = null;
          }
          this.missionControlStore.recordAgentRemoved(agent, 'Terminal closed');
          this.unregisterAgentHook(agent);
          removeAgent(
            id,
            this.agents,
            this.waitingTimers,
            this.permissionTimers,
            this.persistAgents,
          );
          webviewView.webview.postMessage({ type: 'agentClosed', id });
        }
      }
    });
  }

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

  private async loadAllCharacterSprites(): Promise<LoadedCharacterSprites | null> {
    if (!this.assetsRoot) return null;
    let chars = await loadCharacterSprites(this.assetsRoot);
    const config = readConfig();
    for (const extraDir of config.externalAssetDirectories) {
      console.log('[Extension] Loading external character sprites from:', extraDir);
      const extra = await loadExternalCharacterSprites(extraDir);
      if (extra) {
        chars = chars ? mergeCharacterSprites(chars, extra) : extra;
      }
    }
    return chars;
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

  private async reloadAndSendCharacters(): Promise<void> {
    if (!this.assetsRoot || !this.webview) return;
    try {
      const chars = await this.loadAllCharacterSprites();
      if (chars) {
        sendCharacterSpritesToWebview(this.webview, chars);
      }
    } catch (err) {
      console.error('[Extension] Error reloading character sprites:', err);
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
    this.missionControlUnsubscribe?.();
    this.missionControlUnsubscribe = null;
    this.missionControlStore.dispose();
    this.pixelAgentsServer?.stop();
    this.pixelAgentsServer = null;
    this.hookEventHandler?.dispose();
    this.hookEventHandler = null;
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    for (const id of [...this.agents.keys()]) {
      removeAgent(id, this.agents, this.waitingTimers, this.permissionTimers, this.persistAgents);
    }
  }
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
