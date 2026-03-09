/**
 * AppController — Main orchestrator for the Electron app.
 * Replaces PixelAgentsViewProvider.ts from the VS Code extension.
 *
 * Wires together:
 * - ProcessManager (child_process.spawn for Claude sessions)
 * - Shared file watching, transcript parsing, timer management (from src/)
 * - Asset loading (from src/assetLoader.ts)
 * - Layout persistence (from src/layoutPersistence.ts)
 * - Simple JSON store (electron/store.ts)
 */

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
} from '../src/assetLoader.js';
import { JSONL_POLL_INTERVAL_MS } from '../src/constants.js';
import { ensureProjectScan, readNewLines, startFileWatching } from '../src/fileWatcher.js';
import type { LayoutWatcher } from '../src/layoutPersistence.js';
import {
  readLayoutFromFile,
  watchLayoutFile,
  writeLayoutToFile,
} from '../src/layoutPersistence.js';
import { cancelPermissionTimer, cancelWaitingTimer } from '../src/timerManager.js';
import type { AgentState, MessageSender, PersistedAgent } from '../src/types.js';
import { ProcessManager } from './processManager.js';
import { store } from './store.js';

// Store keys (match VS Code extension keys for compatibility)
const STORE_KEY_AGENTS = 'pixel-agents.agents';
const STORE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
const STORE_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';

export class AppController {
  private processManager = new ProcessManager();
  private agents = new Map<number, AgentState>();
  private sender: MessageSender;

  // Agent ID counter — shared with ensureProjectScan for /clear + adoption
  private nextAgentIdRef = { current: 1 };

  // Per-agent timers (same maps as VS Code extension)
  private fileWatchers = new Map<number, fs.FSWatcher>();
  private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();

  // /clear detection: project-level scan for new JSONL files
  private activeAgentId = { current: null as number | null };
  private knownJsonlFiles = new Set<string>();
  private projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

  // Bundled default layout
  private defaultLayout: Record<string, unknown> | null = null;

  // Cross-window layout sync
  private layoutWatcher: LayoutWatcher | null = null;

  // Path to bundled assets (set from main.ts)
  private assetsRoot: string | null = null;

  /**
   * @param sendMessage — function to send IPC messages to the renderer
   * @param appPath — app.getAppPath(), used to locate bundled assets
   */
  constructor(sendMessage: (message: unknown) => void, appPath: string) {
    this.sender = { postMessage: sendMessage };

    // Resolve assets root: dist/assets/ relative to the app path
    const bundledAssetsDir = path.join(appPath, 'dist', 'assets');
    if (fs.existsSync(bundledAssetsDir)) {
      this.assetsRoot = path.join(appPath, 'dist');
    }

    // Wire process exit → agent cleanup
    this.processManager.onProcessExit = (id: number) => {
      this.handleProcessExit(id);
    };
  }

  // ── IPC Message Dispatch ─────────────────────────────────────

  handleMessage(message: unknown): void {
    const msg = message as Record<string, unknown>;
    const type = msg.type as string;

    switch (type) {
      case 'webviewReady':
        this.handleWebviewReady();
        break;
      case 'openClaude':
        this.handleOpenClaude(msg.folderPath as string | undefined);
        break;
      case 'focusAgent':
        this.handleFocusAgent(msg.id as number);
        break;
      case 'closeAgent':
        this.handleCloseAgent(msg.id as number);
        break;
      case 'saveLayout':
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(msg.layout as Record<string, unknown>);
        break;
      case 'saveAgentSeats':
        store.update(STORE_KEY_AGENT_SEATS, msg.seats);
        break;
      case 'setSoundEnabled':
        store.update(STORE_KEY_SOUND_ENABLED, msg.enabled);
        break;
      default:
        console.log(`[AppController] Unhandled message type: ${type}`);
    }
  }

  // ── Webview Ready ────────────────────────────────────────────

  private handleWebviewReady(): void {
    // Send persisted settings
    const soundEnabled = store.get<boolean>(STORE_KEY_SOUND_ENABLED, true);
    this.sender.postMessage({ type: 'settingsLoaded', soundEnabled });

    // Send existing agents (empty on fresh start)
    this.sendExistingAgents();

    // Start project scan for the current working directory
    const cwd = process.cwd();
    const projectDir = this.getProjectDirPath(cwd);
    if (projectDir) {
      ensureProjectScan(
        projectDir,
        this.knownJsonlFiles,
        this.projectScanTimer,
        this.activeAgentId,
        this.nextAgentIdRef,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.sender,
        () => this.persistAgents(),
        () => this.processManager.getFocusedHandle(),
      );
    }

    // Load and send assets, then layout
    this.loadAndSendAssets();
  }

  // ── Agent Lifecycle ──────────────────────────────────────────

  private handleOpenClaude(folderPath?: string): void {
    const cwd = folderPath || process.cwd();
    const id = this.nextAgentIdRef.current++;
    const result = this.processManager.spawn(id, cwd);

    // Pre-register expected JSONL so project scan won't treat it as a /clear file
    this.knownJsonlFiles.add(result.jsonlFile);

    // Create agent
    const agent: AgentState = {
      id,
      terminalRef: result.handle,
      projectDir: result.projectDir,
      jsonlFile: result.jsonlFile,
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
    };

    this.agents.set(id, agent);
    this.activeAgentId.current = id;
    this.persistAgents();

    console.log(`[AppController] Agent ${id}: created, pid=${result.handle.pid}`);
    this.sender.postMessage({ type: 'agentCreated', id });

    // Start project scan (for /clear detection)
    ensureProjectScan(
      result.projectDir,
      this.knownJsonlFiles,
      this.projectScanTimer,
      this.activeAgentId,
      this.nextAgentIdRef,
      this.agents,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      this.sender,
      () => this.persistAgents(),
      () => this.processManager.getFocusedHandle(),
    );

    // Poll for the JSONL file to appear
    const pollTimer = setInterval(() => {
      try {
        if (fs.existsSync(agent.jsonlFile)) {
          console.log(
            `[AppController] Agent ${id}: found JSONL file ${path.basename(agent.jsonlFile)}`,
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
            this.sender,
          );
          readNewLines(id, this.agents, this.waitingTimers, this.permissionTimers, this.sender);
        }
      } catch {
        /* file may not exist yet */
      }
    }, JSONL_POLL_INTERVAL_MS);
    this.jsonlPollTimers.set(id, pollTimer);
  }

  private handleFocusAgent(id: number): void {
    this.processManager.focus(id);
    this.activeAgentId.current = id;
  }

  private handleCloseAgent(id: number): void {
    this.processManager.kill(id);
    // The exit handler will call handleProcessExit
  }

  private handleProcessExit(id: number): void {
    if (this.activeAgentId.current === id) {
      this.activeAgentId.current = null;
    }
    this.removeAgent(id);
    this.sender.postMessage({ type: 'agentClosed', id });
  }

  // ── Agent Removal ────────────────────────────────────────────

  private removeAgent(agentId: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Stop JSONL poll timer
    const jpTimer = this.jsonlPollTimers.get(agentId);
    if (jpTimer) {
      clearInterval(jpTimer);
    }
    this.jsonlPollTimers.delete(agentId);

    // Stop file watching
    this.fileWatchers.get(agentId)?.close();
    this.fileWatchers.delete(agentId);
    const pt = this.pollingTimers.get(agentId);
    if (pt) {
      clearInterval(pt);
    }
    this.pollingTimers.delete(agentId);
    try {
      fs.unwatchFile(agent.jsonlFile);
    } catch {
      /* ignore */
    }

    // Cancel timers
    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);

    // Remove from map
    this.agents.delete(agentId);
    this.persistAgents();
  }

  // ── Persistence ──────────────────────────────────────────────

  private persistAgents(): void {
    const persisted: PersistedAgent[] = [];
    for (const agent of this.agents.values()) {
      persisted.push({
        id: agent.id,
        terminalName: agent.terminalRef.name,
        jsonlFile: agent.jsonlFile,
        projectDir: agent.projectDir,
        folderName: agent.folderName,
      });
    }
    store.update(STORE_KEY_AGENTS, persisted);
  }

  private sendExistingAgents(): void {
    const agentIds: number[] = [];
    for (const id of this.agents.keys()) {
      agentIds.push(id);
    }
    agentIds.sort((a, b) => a - b);

    const agentMeta = store.get<Record<string, { palette?: number; seatId?: string }>>(
      STORE_KEY_AGENT_SEATS,
      {},
    );

    const folderNames: Record<number, string> = {};
    for (const [id, agent] of this.agents) {
      if (agent.folderName) {
        folderNames[id] = agent.folderName;
      }
    }

    this.sender.postMessage({
      type: 'existingAgents',
      agents: agentIds,
      agentMeta,
      folderNames,
    });

    // Re-send current statuses for any active agents
    for (const [agentId, agent] of this.agents) {
      for (const [toolId, status] of agent.activeToolStatuses) {
        this.sender.postMessage({
          type: 'agentToolStart',
          id: agentId,
          toolId,
          status,
        });
      }
      if (agent.isWaiting) {
        this.sender.postMessage({
          type: 'agentStatus',
          id: agentId,
          status: 'waiting',
        });
      }
    }
  }

  // ── Asset Loading ────────────────────────────────────────────

  private async loadAndSendAssets(): Promise<void> {
    try {
      const assetsRoot = this.assetsRoot;
      if (!assetsRoot) {
        console.log('[AppController] No assets directory found');
        this.sendLayout();
        this.startLayoutWatcher();
        return;
      }

      console.log(`[AppController] Loading assets from: ${assetsRoot}`);

      // Load bundled default layout
      this.defaultLayout = loadDefaultLayout(assetsRoot);

      // Load character sprites
      const charSprites = await loadCharacterSprites(assetsRoot);
      if (charSprites) {
        sendCharacterSpritesToWebview(this.sender, charSprites);
      }

      // Load floor tiles
      const floorTiles = await loadFloorTiles(assetsRoot);
      if (floorTiles) {
        sendFloorTilesToWebview(this.sender, floorTiles);
      }

      // Load wall tiles
      const wallTiles = await loadWallTiles(assetsRoot);
      if (wallTiles) {
        sendWallTilesToWebview(this.sender, wallTiles);
      }

      // Load furniture assets
      const assets = await loadFurnitureAssets(assetsRoot);
      if (assets) {
        sendAssetsToWebview(this.sender, assets);
      }
    } catch (err) {
      console.error('[AppController] Error loading assets:', err);
    }

    // Always send layout after assets
    this.sendLayout();
    this.startLayoutWatcher();
  }

  // ── Layout ───────────────────────────────────────────────────

  private sendLayout(): void {
    // Simplified migrateAndLoadLayout for Electron (no workspace state to migrate)
    let layout = readLayoutFromFile();
    if (!layout && this.defaultLayout) {
      console.log('[AppController] Writing bundled default layout to file');
      writeLayoutToFile(this.defaultLayout);
      layout = this.defaultLayout;
    }

    this.sender.postMessage({ type: 'layoutLoaded', layout });
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[AppController] External layout change — pushing to webview');
      this.sender.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  // ── Utility ──────────────────────────────────────────────────

  private getProjectDirPath(cwd: string): string | null {
    const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', dirName);
  }

  // ── Cleanup ──────────────────────────────────────────────────

  dispose(): void {
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;

    // Remove all agents
    for (const id of [...this.agents.keys()]) {
      this.removeAgent(id);
    }

    // Stop project scan
    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }

    // Kill all child processes
    this.processManager.killAll();
  }
}
