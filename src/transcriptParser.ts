import type * as vscode from 'vscode';

import { processClaudeTranscriptLine } from './claudeTranscriptParser.js';
import { processCopilotTranscriptLine } from './copilotTranscriptParser.js';
import type { AgentState } from './types.js';

export { CLAUDE_PERMISSION_EXEMPT_TOOLS } from './claudeTranscriptParser.js';
export { COPILOT_PERMISSION_EXEMPT_TOOLS } from './copilotTranscriptParser.js';

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function processTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  if (agent.provider === 'claude') {
    processClaudeTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
  } else {
    processCopilotTranscriptLine(agentId, line, agents, waitingTimers, permissionTimers, webview);
  }
}
