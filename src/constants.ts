// ── Timing (ms) ──────────────────────────────────────────────
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 1000;
export const PROJECT_SCAN_INTERVAL_MS = 1000;
export const TOOL_DONE_DELAY_MS = 300;
export const PERMISSION_TIMER_DELAY_MS = 7000;
export const TEXT_IDLE_DELAY_MS = 5000;

// ── Display Truncation ──────────────────────────────────────
export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ── User-Level Layout Persistence ─────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';

// ── Settings Persistence ────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
export const TERMINAL_NAME_PREFIX_CLAUDE = 'Claude Code';
export const TERMINAL_NAME_PREFIX_CODEX = 'Codex';

// ── Backend Session Paths & Commands ────────────────────────
export const CLAUDE_DIR_NAME = '.claude';
export const CLAUDE_PROJECTS_DIR_NAME = 'projects';
export const CLAUDE_SESSION_COMMAND = 'claude';
export const CODEX_DIR_NAME = '.codex';
export const CODEX_SESSIONS_DIR_NAME = 'sessions';
export const buildCodexSessionCommand = (_sessionId: string) => `codex`;

export const TOOL_NAMES = {
  TASK: 'Task',
  AGENT: 'Agent',
  ASK_USER_QUESTION: 'AskUserQuestion',
  REQUEST_USER_INPUT: 'request_user_input',
  BASH: 'Bash',
  READ: 'Read',
  EDIT: 'Edit',
  WRITE: 'Write',
  GLOB: 'Glob',
  GREP: 'Grep',
  WEB_FETCH: 'WebFetch',
  WEB_SEARCH: 'WebSearch',
  ENTER_PLAN_MODE: 'EnterPlanMode',
  NOTEBOOK_EDIT: 'NotebookEdit',
  SHELL_COMMAND: 'shell_command',
  EXEC_COMMAND: 'exec_command',
  APPLY_PATCH: 'apply_patch',
  READ_FILE: 'read_file',
  LIST_DIR: 'list_dir',
  WEB_SEARCH_CALL: 'web_search_call',
  WRITE_STDIN: 'write_stdin',
  WAIT: 'wait',
  SPAWN_AGENT: 'spawn_agent',
  UPDATE_PLAN: 'update_plan',
} as const;

export const TOOL_STATUS_TEXT = {
  SUBTASK_PREFIX: 'Subtask: ',
  RUNNING_SUBTASK: 'Running subtask',
  RUNNING_PREFIX: 'Running: ',
  READING: 'Reading',
  EDITING: 'Editing',
  WRITING: 'Writing',
  WAITING_FOR_YOUR_ANSWER: 'Waiting for your answer',
  PLANNING: 'Planning',
  EDITING_NOTEBOOK: 'Editing notebook',
  APPLYING_PATCH: 'Applying patch',
  SEARCHING_FILES: 'Searching files',
  SEARCHING_CODE: 'Searching code',
  FETCHING_WEB_CONTENT: 'Fetching web content',
  SEARCHING_THE_WEB: 'Searching the web',
  LISTING_DIRECTORY: 'Listing directory',
  WRITING_TERMINAL_INPUT: 'Writing terminal input',
  READING_TERMINAL_OUTPUT: 'Reading terminal output',
  WAITING_ON_SUBTASK: 'Waiting on subtask',
  USING_PREFIX: 'Using ',
} as const;

export const PERMISSION_EXEMPT_TOOLS = new Set<string>([
  TOOL_NAMES.TASK,
  TOOL_NAMES.AGENT,
  TOOL_NAMES.ASK_USER_QUESTION,
  TOOL_NAMES.REQUEST_USER_INPUT,
  TOOL_NAMES.SPAWN_AGENT,
  TOOL_NAMES.WAIT,
]);

export const FIRST_JSONL_RECORD_READ_BYTES = 8192;
export const JSONL_RECORD_READ_BYTES = FIRST_JSONL_RECORD_READ_BYTES;
