import * as vscode from 'vscode';

import { readConfig } from '../../configPersistence';
import { AgentState } from '../../types';
import { processTranscriptLineClaude } from './ClaudeTranscriptParser';
import { processTranscriptLineCopilot } from './CopilotTranscriptParser';

/**
 * Process a line of transcript for the specified agent. This function determines which transcript parser to use based on the current agent type specified in the configuration.
 * It ensures that the correct parsing logic is applied for each agent type, allowing for proper handling of tool statuses and other agent-specific features.
 */
export default function processTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const config = readConfig();
  switch (config.agent_type) {
    case 'cloud':
      processTranscriptLineClaude(agentId, line, agents, waitingTimers, permissionTimers, webview);
      break;
    case 'copilot':
      processTranscriptLineCopilot(agentId, line, agents, waitingTimers, permissionTimers, webview);
      break;
    default:
      console.error(`[Pixel Agents] Unknown agent type in config: ${config.agent_type}`);
      processTranscriptLineClaude(agentId, line, agents, waitingTimers, permissionTimers, webview);
  }
}
