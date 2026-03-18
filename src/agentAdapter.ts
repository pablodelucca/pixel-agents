import * as vscode from 'vscode';

import { claudeAdapter } from './adapters/claudeAdapter.js';
import { codexAdapter } from './adapters/codexAdapter.js';
import type { AgentBackend, AgentState } from './types.js';

export interface TranscriptProcessingContext {
  agents: Map<number, AgentState>;
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  webview: vscode.Webview | undefined;
}

export interface AgentAdapter {
  name: AgentBackend;
  displayName: string;
  terminalNamePrefix: string;
  getProjectDirPath(cwd?: string): string | null;
  getTerminalCommand(sessionId: string): string;
  getExpectedJsonlFile(projectDir: string, sessionId: string): string | null;
  findJsonlFiles(projectDir: string): string[];
  isRelevantToWorkspace(
    file: string,
    workspaceFolders?: readonly vscode.WorkspaceFolder[],
  ): boolean;
  processTranscriptLine(agentId: number, line: string, context: TranscriptProcessingContext): void;
}

const ADAPTERS: Record<AgentBackend, AgentAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

export function getAgentAdapterByName(name: AgentBackend): AgentAdapter {
  return ADAPTERS[name];
}

export function getConfiguredAgentBackend(): AgentBackend {
  const configured = vscode.workspace
    .getConfiguration('pixel-agents')
    .get<string>('agentType', 'codex');
  return configured === 'claude' ? 'claude' : 'codex';
}

export function getConfiguredAgentAdapter(): AgentAdapter {
  return getAgentAdapterByName(getConfiguredAgentBackend());
}
