export interface ParserAgentState {
  activeToolIds: Set<string>;
  activeToolNames: Map<string, string>;
  activeToolStatuses: Map<string, string>;
  backgroundAgentToolIds: Set<string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  hadToolsInTurn: boolean;
  isWaiting: boolean;
}

export type NormalizedAgentEvent =
  | { type: 'agentCreated'; id: number; folderName?: string }
  | { type: 'agentClosed'; id: number }
  | { type: 'agentStatus'; id: number; status: 'active' | 'waiting' }
  | {
      type: 'agentToolStart';
      id: number;
      toolId: string;
      status: string;
      toolName?: string;
    }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'agentToolsClear'; id: number }
  | {
      type: 'subagentToolStart';
      id: number;
      parentToolId: string;
      toolId: string;
      status: string;
    }
  | {
      type: 'subagentToolDone';
      id: number;
      parentToolId: string;
      toolId: string;
    }
  | {
      type: 'subagentClear';
      id: number;
      parentToolId: string;
    }
  | { type: 'settingsLoaded'; payload: Record<string, unknown> }
  | { type: 'layoutLoaded'; payload: Record<string, unknown> }
  | { type: 'assetsLoaded'; payload: Record<string, unknown> };

export function createParserState(): ParserAgentState {
  return {
    activeToolIds: new Set(),
    activeToolNames: new Map(),
    activeToolStatuses: new Map(),
    backgroundAgentToolIds: new Set(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    hadToolsInTurn: false,
    isWaiting: false,
  };
}
