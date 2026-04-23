// src/orchestratorManager.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { HookEventHandler } from '../server/src/hookEventHandler.js';
import {
  HeadlessSpawner,
  type HeadlessSpawnResult,
  type Role,
  RoleStore,
} from '../server/src/orchestrator/index.js';
import { getProjectDirPath } from './agentManager.js';
import { ensureProjectScan, readNewLines, startFileWatching } from './fileWatcher.js';
import type { AgentState } from './types.js';

/**
 * OrchestratorManager integra o orquestrador ao ciclo de vida de agentes do VS Code.
 *
 * Responsabilidades:
 *   1. Expor roleStore (lista de papéis) pro comando "Delegate Task".
 *   2. Spawnar processo headless via HeadlessSpawner.
 *   3. Criar AgentState "headless" (sem terminalRef), adicionar à Map de agentes.
 *   4. Registrar session_id → agentId no HookEventHandler.
 *   5. Notificar o webview via postMessage('agentCreated') — personagem aparece.
 *   6. Limpar quando o processo Claude termina (SessionEnd do hook despawna).
 */
export class OrchestratorManager {
  readonly roleStore: RoleStore;
  private spawner = new HeadlessSpawner();
  private activeProcesses = new Map<number, HeadlessSpawnResult>();

  constructor(
    private extensionUri: vscode.Uri,
    private nextAgentIdRef: { current: number },
    private agents: Map<number, AgentState>,
    private knownJsonlFiles: Set<string>,
    private fileWatchers: Map<number, fs.FSWatcher>,
    private pollingTimers: Map<number, ReturnType<typeof setInterval>>,
    private waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    private permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    private jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
    private projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
    private activeAgentIdRef: { current: number | null },
    private hookHandler: HookEventHandler,
    private getWebview: () => vscode.Webview | undefined,
    private persistAgents: () => void,
  ) {
    const userRolesPath = path.join(os.homedir(), '.pixel-agents', 'roles.json');
    const bundledDefaults = vscode.Uri.joinPath(
      this.extensionUri,
      'dist',
      'assets',
      'default-roles.json',
    ).fsPath;
    this.roleStore = new RoleStore(userRolesPath, bundledDefaults);
  }

  async delegate(roleId: string, task: string, cwd?: string): Promise<number> {
    const role = await this.roleStore.get(roleId);
    if (!role) throw new Error(`OrchestratorManager: role "${roleId}" not found`);

    const workspaceCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

    const result = this.spawner.spawn({ role, task, cwd: workspaceCwd });
    const agentId = this.createHeadlessAgent(result, role, workspaceCwd);
    this.activeProcesses.set(agentId, result);

    // Catch async spawn errors (e.g. ENOENT if claude binary is missing)
    result.process.on('error', (err) => {
      console.error(
        `[Pixel Agents] Orchestrator: Agent ${agentId} (${role.id}) spawn error: ${err.message}`,
      );
      this.activeProcesses.delete(agentId);
    });

    result.process.on('exit', (code) => {
      console.log(
        `[Pixel Agents] Orchestrator: Agent ${agentId} (${role.id}) exited with code ${code}`,
      );
      this.activeProcesses.delete(agentId);
    });

    return agentId;
  }

  private createHeadlessAgent(spawn: HeadlessSpawnResult, role: Role, cwd: string): number {
    const id = this.nextAgentIdRef.current++;
    const projectDir = getProjectDirPath(cwd);
    const expectedFile = path.join(projectDir, `${spawn.sessionId}.jsonl`);
    this.knownJsonlFiles.add(expectedFile);

    const agent: AgentState = {
      id,
      sessionId: spawn.sessionId,
      terminalRef: undefined,
      isExternal: false,
      isHeadless: true,
      projectDir,
      jsonlFile: expectedFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: 0,
      linesProcessed: 0,
      seenUnknownRecordTypes: new Set(),
      folderName: role.label,
      hookDelivered: false,
      inputTokens: 0,
      outputTokens: 0,
    };

    this.agents.set(id, agent);
    this.hookHandler.registerAgent(spawn.sessionId, id);
    this.persistAgents();

    const webview = this.getWebview();
    webview?.postMessage({
      type: 'agentCreated',
      id,
      folderName: role.label,
      palette: role.palette,
      hueShift: role.hueShift,
      isHeadless: true,
    });

    console.log(
      `[Pixel Agents] Orchestrator: Agent ${id} created headless (role=${role.id}, session=${spawn.sessionId.slice(0, 8)}...)`,
    );

    ensureProjectScan(
      projectDir,
      this.knownJsonlFiles,
      this.projectScanTimerRef,
      this.activeAgentIdRef,
      this.nextAgentIdRef,
      this.agents,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      webview,
      this.persistAgents,
    );

    this.startJsonlPolling(id, agent);
    return id;
  }

  private startJsonlPolling(id: number, agent: AgentState): void {
    let pollCount = 0;
    const pollTimer = setInterval(() => {
      pollCount++;
      try {
        if (fs.existsSync(agent.jsonlFile)) {
          clearInterval(pollTimer);
          this.jsonlPollTimers.delete(id);
          const webview = this.getWebview();
          startFileWatching(
            id,
            agent.jsonlFile,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            webview,
          );
          readNewLines(id, this.agents, this.waitingTimers, this.permissionTimers, webview);
          return;
        }
        if (pollCount > 30) {
          console.warn(
            `[Pixel Agents] Orchestrator: Agent ${id} - JSONL never appeared, giving up`,
          );
          clearInterval(pollTimer);
          this.jsonlPollTimers.delete(id);
        }
      } catch {
        // ignore transient fs errors
      }
    }, 1000);
    this.jsonlPollTimers.set(id, pollTimer);
  }

  dispose(): void {
    for (const [id, result] of this.activeProcesses) {
      try {
        result.process.kill('SIGTERM');
      } catch {
        // ignore
      }
      console.log(`[Pixel Agents] Orchestrator: killed headless agent ${id} on dispose`);
    }
    this.activeProcesses.clear();
  }
}
