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

    // Attach listeners BEFORE createHeadlessAgent so spawn errors don't orphan the subprocess.
    // agentId is not known until after createHeadlessAgent; use a mutable holder.
    const agentIdRef: { current: number | undefined } = { current: undefined };

    result.process.on('error', (err) => {
      const idText = agentIdRef.current !== undefined ? String(agentIdRef.current) : '(pre-init)';
      console.error(
        `[Pixel Agents] Orchestrator: Agent ${idText} (${role.id}) spawn error: ${err.message}`,
      );
      if (agentIdRef.current !== undefined) {
        this.activeProcesses.delete(agentIdRef.current);
      }
    });

    result.process.on('exit', (code) => {
      const idText = agentIdRef.current !== undefined ? String(agentIdRef.current) : '(pre-init)';
      console.log(
        `[Pixel Agents] Orchestrator: Agent ${idText} (${role.id}) exited with code ${code}`,
      );
      if (agentIdRef.current !== undefined) {
        this.activeProcesses.delete(agentIdRef.current);
      }
      // NOTE: character despawn is intentionally driven by the SessionEnd hook, not here,
      // so the lifecycle is hook-authoritative. If hooks are disabled, see I2 handling in
      // startJsonlPolling timeout.
    });

    try {
      const agentId = this.createHeadlessAgent(result, role, workspaceCwd);
      agentIdRef.current = agentId;
      this.activeProcesses.set(agentId, result);
      return agentId;
    } catch (err) {
      try {
        result.process.kill('SIGTERM');
      } catch {
        // subprocess may already be dead — ignore
      }
      throw err;
    }
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
            `[Pixel Agents] Orchestrator: Agent ${id} - JSONL never appeared, despawning ghost agent`,
          );
          clearInterval(pollTimer);
          this.jsonlPollTimers.delete(id);
          this.forceDespawn(id, agent);
        }
      } catch {
        // ignore
      }
    }, 1000);
    this.jsonlPollTimers.set(id, pollTimer);
  }

  /** Clean up a headless agent that never delivered a JSONL file (subprocess errored early). */
  private forceDespawn(id: number, agent: AgentState): void {
    const result = this.activeProcesses.get(id);
    if (result) {
      try {
        result.process.kill('SIGTERM');
      } catch {
        // already dead
      }
      this.activeProcesses.delete(id);
    }
    this.hookHandler.unregisterAgent(agent.sessionId);
    this.agents.delete(id);
    this.persistAgents();
    this.getWebview()?.postMessage({ type: 'agentClosed', id });
  }

  dispose(): void {
    for (const [id, result] of this.activeProcesses) {
      // Clear any pending JSONL poll timers we started for this agent
      const timer = this.jsonlPollTimers.get(id);
      if (timer) {
        clearInterval(timer);
        this.jsonlPollTimers.delete(id);
      }
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
