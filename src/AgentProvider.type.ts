import * as fs from 'fs';
import * as vscode from 'vscode';

import { AgentState } from './types';

interface IAgent {
  getProjectDirPath(cwd?: string): string;
  launchNewTerminal(
    nextAgentIdRef: { current: number },
    nextTerminalIndexRef: { current: number },
    agents: Map<number, AgentState>,
    activeAgentIdRef: { current: number | null },
    knownJsonlFiles: Set<string>,
    fileWatchers: Map<number, fs.FSWatcher>,
    pollingTimers: Map<number, ReturnType<typeof setInterval>>,
    waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
    projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
    webview: vscode.Webview | undefined,
    persistAgents: () => void,
    folderPath?: string,
    bypassPermissions?: boolean,
  ): Promise<void>;
  removeAgent(
    agentId: number,
    agents: Map<number, AgentState>,
    fileWatchers: Map<number, fs.FSWatcher>,
    pollingTimers: Map<number, ReturnType<typeof setInterval>>,
    waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
    persistAgents: () => void,
  ): void;
  persistAgents(agents: Map<number, AgentState>, context: vscode.ExtensionContext): void;
  restoreAgents(
    context: vscode.ExtensionContext,
    nextAgentIdRef: { current: number },
    nextTerminalIndexRef: { current: number },
    agents: Map<number, AgentState>,
    knownJsonlFiles: Set<string>,
    fileWatchers: Map<number, fs.FSWatcher>,
    pollingTimers: Map<number, ReturnType<typeof setInterval>>,
    waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
    permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
    jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
    projectScanTimerRef: { current: ReturnType<typeof setInterval> | null },
    activeAgentIdRef: { current: number | null },
    webview: vscode.Webview | undefined,
    doPersist: () => void,
  ): void;
  sendExistingAgents(
    agents: Map<number, AgentState>,
    context: vscode.ExtensionContext,
    webview: vscode.Webview | undefined,
  ): void;
  sendCurrentAgentStatuses(
    agents: Map<number, AgentState>,
    webview: vscode.Webview | undefined,
  ): void;
  sendLayout(
    context: vscode.ExtensionContext,
    webview: vscode.Webview | undefined,
    defaultLayout?: Record<string, unknown> | null,
  ): void;
}

export { IAgent };
