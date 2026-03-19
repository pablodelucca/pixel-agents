import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentAdapter } from '../agentAdapter.js';
import {
  CLAUDE_DIR_NAME,
  CLAUDE_PROJECTS_DIR_NAME,
  CLAUDE_SESSION_COMMAND,
  TERMINAL_NAME_PREFIX_CLAUDE,
} from '../constants.js';
import { processClaudeTranscriptLine } from '../transcriptParser.js';
import { findJsonlFilesRecursive, toClaudeProjectHash } from './shared.js';

export const claudeAdapter: AgentAdapter = {
  name: 'claude',
  displayName: 'Claude Code',
  terminalNamePrefix: TERMINAL_NAME_PREFIX_CLAUDE,
  getProjectDirPath(cwd) {
    const workspacePath = cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return null;
    return path.join(
      os.homedir(),
      CLAUDE_DIR_NAME,
      CLAUDE_PROJECTS_DIR_NAME,
      toClaudeProjectHash(workspacePath),
    );
  },
  getTerminalCommand(sessionId) {
    return sessionId
      ? `${CLAUDE_SESSION_COMMAND} --session-id ${sessionId}`
      : CLAUDE_SESSION_COMMAND;
  },
  getExpectedJsonlFile(projectDir, sessionId) {
    return path.join(projectDir, `${sessionId}.jsonl`);
  },
  findJsonlFiles(projectDir) {
    return findJsonlFilesRecursive(projectDir);
  },
  isRelevantToWorkspace() {
    return true;
  },
  processTranscriptLine(agentId, line, context) {
    processClaudeTranscriptLine(
      agentId,
      line,
      context.agents,
      context.waitingTimers,
      context.permissionTimers,
      context.webview,
    );
  },
};
