export type ParsedEvent =
  | {
      type: 'tool_start';
      toolId: string;
      toolName: string;
      status: string;
      isNonExempt: boolean;
    }
  | { type: 'tool_done'; toolId: string }
  | {
      type: 'subtool_start';
      parentToolId: string;
      subToolId: string;
      parentStatus: string;
      subToolName: string;
      subStatus: string;
    }
  | { type: 'subtool_done'; parentToolId: string; subToolId: string }
  | { type: 'subtool_clear'; parentToolId: string }
  | { type: 'text_response' }
  | { type: 'turn_ended' }
  | { type: 'turn_started' }
  | { type: 'session_cwd'; cwd: string };

export interface AgentAdapter {
  name: string;
  terminalNamePrefix: string;
  getProjectDirPath(cwd?: string): string | null;
  getTerminalCommand(sessionId: string): string;
  parseTranscriptLine(line: string): ParsedEvent[];
  findJsonlFiles(projectDir: string): string[];
}
