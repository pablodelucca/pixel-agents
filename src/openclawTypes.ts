// OpenClaw configuration types

export interface OpenClawIdentity {
  name?: string;
  theme?: string;
  emoji?: string;
  avatar?: string;
}

export interface OpenClawAgentConfig {
  id: string;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: string;
  identity?: OpenClawIdentity;
}

export interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
      };
      workspace?: string;
    };
    list?: OpenClawAgentConfig[];
  };
  gateway?: {
    port?: number;
    mode?: string;
    bind?: string;
    auth?: {
      mode?: string;
      token?: string;
    };
  };
}

// OpenClaw JSONL message types

export interface OpenClawContentBlock {
  type: 'text' | 'thinking' | 'toolCall';
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface OpenClawMessage {
  type: 'message';
  id: string;
  parentId?: string;
  timestamp?: string;
  message?: {
    role: 'assistant' | 'user';
    content: OpenClawContentBlock[];
    api?: string;
    provider?: string;
    model?: string;
    usage?: Record<string, unknown>;
    stopReason?: string;
  };
}

export interface OpenClawToolResult {
  type: 'message';
  id: string;
  parentId?: string;
  role?: 'toolResult';
  toolCallId?: string;
  toolName?: string;
  content?: OpenClawContentBlock[];
  details?: Record<string, unknown>;
  isError?: boolean;
  timestamp?: number;
}

export type OpenClawRecord = OpenClawMessage | OpenClawToolResult;

// Internal agent state for OpenClaw

export interface OpenClawAgentState {
  id: number;
  openClawId: string; // agent id in openclaw.json (e.g., "main", "clara")
  name: string;
  emoji: string;
  sessionsDir: string;
  activeSessionFile: string | null;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  isWaiting: boolean;
}
