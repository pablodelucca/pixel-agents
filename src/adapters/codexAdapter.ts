import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentAdapter } from '../agentAdapter.js';
import {
  buildCodexSessionCommand,
  CODEX_DIR_NAME,
  CODEX_SESSIONS_DIR_NAME,
  TERMINAL_NAME_PREFIX_CODEX,
} from '../constants.js';
import { processCodexTranscriptLine } from '../transcriptParser.js';
import { codexSessionBelongsToWorkspace, findJsonlFilesRecursive } from './shared.js';

export const codexAdapter: AgentAdapter = {
  name: 'codex',
  displayName: 'Codex',
  terminalNamePrefix: TERMINAL_NAME_PREFIX_CODEX,
  getProjectDirPath(cwd) {
    const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return null;
    return path.join(os.homedir(), CODEX_DIR_NAME, CODEX_SESSIONS_DIR_NAME);
  },
  getTerminalCommand(sessionId: string) {
    return buildCodexSessionCommand(sessionId);
  },
  getExpectedJsonlFile() {
    return null;
  },
  findJsonlFiles(projectDir) {
    return findJsonlFilesRecursive(projectDir);
  },
  isRelevantToWorkspace(file, workspaceFolders) {
    return codexSessionBelongsToWorkspace(file, workspaceFolders);
  },
  processTranscriptLine(agentId, line, context) {
    processCodexTranscriptLine(
      agentId,
      line,
      context.agents,
      context.waitingTimers,
      context.permissionTimers,
      context.webview,
    );
  },
};
