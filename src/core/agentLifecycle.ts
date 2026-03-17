import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
} from '../assetLoader.js';
import {
  GLOBAL_KEY_SOUND_ENABLED,
  JSONL_POLL_INTERVAL_MS,
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
} from '../constants.js';
import {
  ensureProjectScan,
  readNewLines,
  reassignAgentToFile,
  startFileWatching,
} from '../fileWatcher.js';
import type { LayoutWatcher } from '../layoutPersistence.js';
import {
  migrateAndLoadLayout,
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from '../layoutPersistence.js';
import type {
  IAgentHandle,
  IPixelAgentsPlugin,
  PersistedAgentHandle,
  PostMessage,
} from '../plugin/types.js';
import { cancelPermissionTimer, cancelWaitingTimer } from '../timerManager.js';
import type { AgentState } from '../types.js';

function getProjectDir(workspacePath: string): string {
  const dirName = workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);
  console.log(`[Pixel Agents] Project dir: ${workspacePath} → ${dirName}`);
  return projectDir;
}

export class AgentLifecycle {
  private agents = new Map<number, AgentState>();
  private nextAgentId = { current: 1 };
  private activeAgentId = { current: null as number | null };
  private knownJsonlFiles = new Set<string>();
  private projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };
  private fileWatchers = new Map<number, fs.FSWatcher>();
  private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  private layoutWatcher: LayoutWatcher | null = null;
  private defaultLayout: Record<string, unknown> | null = null;

  constructor(private readonly plugin: IPixelAgentsPlugin) {}

  start(): void {
    const { agentProvider, messageBridge, runtimeUI } = this.plugin;

    messageBridge.onReady(() => void this.handleWebviewReady());

    messageBridge.onMessage((message) => {
      if (message.type !== 'webviewReady') {
        void this.handleWebviewMessage(message);
      }
    });

    agentProvider.onAgentClosed((id) => {
      this.handleAgentClosed(id);
    });

    if (agentProvider.onAgentFocused) {
      agentProvider.onAgentFocused((id) => {
        this.activeAgentId.current = id;
        if (id !== null) {
          messageBridge.postMessage({ type: 'agentSelected', id });
        }
      });
    }

    runtimeUI.onWorkspaceFoldersChanged((folders) => {
      if (folders.length > 1) {
        messageBridge.postMessage({ type: 'workspaceFolders', folders });
      }
    });
  }

  private get postMessage(): PostMessage {
    return (message) => this.plugin.messageBridge.postMessage(message);
  }

  private persistAgents(): void {
    const persisted: PersistedAgentHandle[] = [];
    for (const agent of this.agents.values()) {
      persisted.push(agent.handle.serialize());
    }
    void this.plugin.runtimeUI.setState(WORKSPACE_KEY_AGENTS, persisted);
  }

  private createAgentState(
    handle: IAgentHandle,
    projectDir: string,
    jsonlFile: string,
    folderName?: string,
  ): AgentState {
    return {
      id: handle.id,
      handle,
      projectDir,
      jsonlFile,
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
  }

  private startJsonlPolling(agent: AgentState): void {
    const id = agent.id;
    const pollTimer = setInterval(() => {
      try {
        if (fs.existsSync(agent.jsonlFile)) {
          console.log(
            `[Pixel Agents] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`,
          );
          clearInterval(pollTimer);
          this.jsonlPollTimers.delete(id);
          startFileWatching(
            id,
            agent.jsonlFile,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.postMessage,
          );
          readNewLines(
            id,
            this.agents,
            this.waitingTimers,
            this.permissionTimers,
            this.postMessage,
          );
        }
      } catch {
        /* file may not exist yet */
      }
    }, JSONL_POLL_INTERVAL_MS);
    this.jsonlPollTimers.set(id, pollTimer);
  }

  private removeAgent(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const jpTimer = this.jsonlPollTimers.get(agentId);
    if (jpTimer) clearInterval(jpTimer);
    this.jsonlPollTimers.delete(agentId);

    this.fileWatchers.get(agentId)?.close();
    this.fileWatchers.delete(agentId);
    const pt = this.pollingTimers.get(agentId);
    if (pt) clearInterval(pt);
    this.pollingTimers.delete(agentId);
    try {
      fs.unwatchFile(agent.jsonlFile);
    } catch {
      /* ignore */
    }

    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);
    this.agents.delete(agentId);
    this.persistAgents();
  }

  private handleAgentClosed(agentId: number): void {
    if (this.activeAgentId.current === agentId) {
      this.activeAgentId.current = null;
    }
    this.removeAgent(agentId);
    this.plugin.messageBridge.postMessage({ type: 'agentClosed', id: agentId });
  }

  private async handleWebviewReady(): Promise<void> {
    const { agentProvider, messageBridge, runtimeUI } = this.plugin;

    // Restore agents from persisted state
    const persisted = runtimeUI.getState<PersistedAgentHandle[]>(WORKSPACE_KEY_AGENTS) ?? [];
    if (persisted.length > 0) {
      const handles = await agentProvider.restoreAgents(persisted);
      let maxId = 0;

      for (const handle of handles) {
        const agent = this.createAgentState(
          handle,
          getProjectDir(handle.workspacePath),
          path.join(getProjectDir(handle.workspacePath), `${handle.sessionId}.jsonl`),
          undefined,
        );

        // Find original persisted entry for folderName
        const p = persisted.find((x) => x.id === handle.id);
        if (p?.folderName) {
          agent.folderName = p.folderName as string;
        }

        this.agents.set(handle.id, agent);
        this.knownJsonlFiles.add(agent.jsonlFile);
        console.log(`[Pixel Agents] Restored agent ${handle.id} → "${handle.displayName}"`);

        if (handle.id > maxId) maxId = handle.id;

        try {
          if (fs.existsSync(agent.jsonlFile)) {
            const stat = fs.statSync(agent.jsonlFile);
            agent.fileOffset = stat.size;
            startFileWatching(
              handle.id,
              agent.jsonlFile,
              this.agents,
              this.fileWatchers,
              this.pollingTimers,
              this.waitingTimers,
              this.permissionTimers,
              this.postMessage,
            );
          } else {
            this.startJsonlPolling(agent);
          }
        } catch {
          /* ignore */
        }
      }

      if (maxId >= this.nextAgentId.current) {
        this.nextAgentId.current = maxId + 1;
      }

      // Re-persist cleaned-up list (entries whose processes are gone are dropped)
      this.persistAgents();
    }

    // Send settings
    const soundEnabled = runtimeUI.getGlobalState<boolean>(GLOBAL_KEY_SOUND_ENABLED) ?? true;
    messageBridge.postMessage({ type: 'settingsLoaded', soundEnabled });

    // Send workspace folders (multi-root only)
    const folders = runtimeUI.getWorkspaceFolders();
    if (folders.length > 1) {
      messageBridge.postMessage({ type: 'workspaceFolders', folders });
    }

    // Determine assets root
    const workspacePath = folders[0]?.path;
    const projectDir = workspacePath ? getProjectDir(workspacePath) : null;
    console.log('[Extension] workspacePath:', workspacePath);
    console.log('[Extension] projectDir:', projectDir);

    if (projectDir) {
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
        this.postMessage,
        this.persistAgents.bind(this),
        (file, pd) => this.onNewUnownedFile(file, pd),
      );
    }

    // Load and send assets
    await this.loadAndSendAssets(workspacePath);

    // Send existing agents
    this.sendExistingAgents();
  }

  private onNewUnownedFile(file: string, projectDir: string): void {
    const { agentProvider, messageBridge } = this.plugin;
    if (this.activeAgentId.current !== null) {
      // Active agent → reassign
      console.log(
        `[Pixel Agents] New JSONL detected: ${path.basename(file)}, reassigning to agent ${this.activeAgentId.current}`,
      );
      reassignAgentToFile(
        this.activeAgentId.current,
        file,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.postMessage,
        this.persistAgents.bind(this),
      );
      return;
    }

    if (!agentProvider.adoptForFile) return;
    const id = this.nextAgentId.current++;
    const handle = agentProvider.adoptForFile(file, projectDir, id);
    if (!handle) {
      this.nextAgentId.current--; // give back the ID
      return;
    }

    const agent = this.createAgentState(handle, projectDir, file);
    this.agents.set(id, agent);
    this.activeAgentId.current = id;
    this.persistAgents();

    messageBridge.postMessage({ type: 'agentCreated', id });
    startFileWatching(
      id,
      file,
      this.agents,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      this.postMessage,
    );
    readNewLines(id, this.agents, this.waitingTimers, this.permissionTimers, this.postMessage);
  }

  private async loadAndSendAssets(workspacePath: string | undefined): Promise<void> {
    let assetsRoot: string | undefined = this.plugin.getAssetsRoot?.();
    if (!assetsRoot && workspacePath) {
      assetsRoot = workspacePath;
    }

    if (!assetsRoot) {
      console.log('[Extension] ⚠️  No assets directory found');
      this.sendLayout();
      this.startLayoutWatcher();
      return;
    }

    console.log('[Extension] Using assetsRoot:', assetsRoot);

    try {
      this.defaultLayout = loadDefaultLayout(assetsRoot);

      const charSprites = await loadCharacterSprites(assetsRoot);
      if (charSprites) sendCharacterSpritesToWebview(this.postMessage, charSprites);

      const floorTiles = await loadFloorTiles(assetsRoot);
      if (floorTiles) sendFloorTilesToWebview(this.postMessage, floorTiles);

      const wallTiles = await loadWallTiles(assetsRoot);
      if (wallTiles) sendWallTilesToWebview(this.postMessage, wallTiles);

      const assets = await loadFurnitureAssets(assetsRoot);
      if (assets) {
        console.log('[Extension] ✅ Assets loaded, sending to webview');
        sendAssetsToWebview(this.postMessage, assets);
      }
    } catch (err) {
      console.error('[Extension] ❌ Error loading assets:', err);
    }

    // Always send layout after assets (even if asset loading failed)
    this.sendLayout();
    this.startLayoutWatcher();
  }

  private sendLayout(): void {
    const result = migrateAndLoadLayout(this.plugin.runtimeUI, this.defaultLayout);
    this.plugin.messageBridge.postMessage({
      type: 'layoutLoaded',
      layout: result?.layout ?? null,
      wasReset: result?.wasReset ?? false,
    });
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[Pixel Agents] External layout change — pushing to webview');
      this.plugin.messageBridge.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  private sendExistingAgents(): void {
    const { messageBridge, runtimeUI } = this.plugin;
    const agentIds: number[] = [];
    for (const id of this.agents.keys()) agentIds.push(id);
    agentIds.sort((a, b) => a - b);

    const agentMeta =
      runtimeUI.getState<Record<string, { palette?: number; seatId?: string }>>(
        WORKSPACE_KEY_AGENT_SEATS,
      ) ?? {};

    const folderNames: Record<number, string> = {};
    for (const [id, agent] of this.agents) {
      if (agent.folderName) folderNames[id] = agent.folderName;
    }

    messageBridge.postMessage({ type: 'existingAgents', agents: agentIds, agentMeta, folderNames });

    // Re-send active statuses
    for (const [agentId, agent] of this.agents) {
      for (const [toolId, status] of agent.activeToolStatuses) {
        messageBridge.postMessage({ type: 'agentToolStart', id: agentId, toolId, status });
      }
      if (agent.isWaiting) {
        messageBridge.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      }
    }
  }

  private async handleWebviewMessage(message: Record<string, unknown>): Promise<void> {
    const { agentProvider, messageBridge, runtimeUI } = this.plugin;

    if (message.type === 'openClaude') {
      const folderPath = message.folderPath as string | undefined;
      const folders = runtimeUI.getWorkspaceFolders();
      const workspacePath = folderPath ?? folders[0]?.path;
      if (!workspacePath) {
        console.log('[Pixel Agents] No workspace path, cannot spawn agent');
        return;
      }
      const isMultiRoot = folders.length > 1;
      const id = this.nextAgentId.current++;
      const sessionId = crypto.randomUUID();
      const projectDir = getProjectDir(workspacePath);
      const expectedFile = path.join(projectDir, `${sessionId}.jsonl`);
      this.knownJsonlFiles.add(expectedFile);

      const handle = await agentProvider.spawnAgent({ id, sessionId, workspacePath });
      const folderName = isMultiRoot ? path.basename(workspacePath) : undefined;
      const agent = this.createAgentState(handle, projectDir, expectedFile, folderName);

      this.agents.set(id, agent);
      this.activeAgentId.current = id;
      this.persistAgents();
      console.log(`[Pixel Agents] Agent ${id}: created`);
      messageBridge.postMessage({ type: 'agentCreated', id, folderName });

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
        this.postMessage,
        this.persistAgents.bind(this),
        (file, pd) => this.onNewUnownedFile(file, pd),
      );

      this.startJsonlPolling(agent);
    } else if (message.type === 'focusAgent') {
      const agent = this.agents.get(message.id as number);
      agent?.handle.focus();
    } else if (message.type === 'closeAgent') {
      const agent = this.agents.get(message.id as number);
      agent?.handle.close();
    } else if (message.type === 'saveAgentSeats') {
      console.log('[Pixel Agents] saveAgentSeats:', JSON.stringify(message.seats));
      await runtimeUI.setState(WORKSPACE_KEY_AGENT_SEATS, message.seats);
    } else if (message.type === 'saveLayout') {
      this.layoutWatcher?.markOwnWrite();
      writeLayoutToFile(message.layout as Record<string, unknown>);
    } else if (message.type === 'setSoundEnabled') {
      await runtimeUI.setGlobalState(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
    } else if (message.type === 'openSessionsFolder') {
      const folders = runtimeUI.getWorkspaceFolders();
      const workspacePath = folders[0]?.path;
      if (workspacePath) {
        const projectDir = getProjectDir(workspacePath);
        if (fs.existsSync(projectDir)) {
          await runtimeUI.openPath(projectDir);
        }
      }
    } else if (message.type === 'exportLayout') {
      const layout = readLayoutFromFile();
      if (!layout) {
        await runtimeUI.showInformationMessage('Pixel Agents: No saved layout to export.');
        return;
      }
      const savePath = await runtimeUI.showSaveDialog({
        filters: { 'JSON Files': ['json'] },
        defaultPath: path.join(os.homedir(), 'pixel-agents-layout.json'),
      });
      if (savePath) {
        fs.writeFileSync(savePath, JSON.stringify(layout, null, 2), 'utf-8');
        await runtimeUI.showInformationMessage('Pixel Agents: Layout exported successfully.');
      }
    } else if (message.type === 'importLayout') {
      const paths = await runtimeUI.showOpenDialog({
        filters: { 'JSON Files': ['json'] },
        canSelectMany: false,
      });
      if (!paths || paths.length === 0) return;
      try {
        const raw = fs.readFileSync(paths[0], 'utf-8');
        const imported = JSON.parse(raw) as Record<string, unknown>;
        if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
          await runtimeUI.showErrorMessage('Pixel Agents: Invalid layout file.');
          return;
        }
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(imported);
        messageBridge.postMessage({ type: 'layoutLoaded', layout: imported });
        await runtimeUI.showInformationMessage('Pixel Agents: Layout imported successfully.');
      } catch {
        await runtimeUI.showErrorMessage('Pixel Agents: Failed to read or parse layout file.');
      }
    }
  }

  dispose(): void {
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    for (const id of [...this.agents.keys()]) {
      this.removeAgent(id);
    }
    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }
  }
}
