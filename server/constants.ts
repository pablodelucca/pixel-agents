// -- Timing (ms) --
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 1000;
export const PROJECT_SCAN_INTERVAL_MS = 1000;
export const TOOL_DONE_DELAY_MS = 300;
export const PERMISSION_TIMER_DELAY_MS = 7000;
export const TEXT_IDLE_DELAY_MS = 5000;
export const SESSION_SCAN_INTERVAL_MS = 5000;
export const SESSION_ACTIVE_THRESHOLD_MS = 30000;

// -- Display Truncation --
export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// -- PNG / Asset Parsing --
export const PNG_ALPHA_THRESHOLD = 128;

// -- User-Level Persistence --
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const SETTINGS_FILE_NAME = 'settings.json';
export const AGENTS_FILE_NAME = 'agents.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;

// -- Chat Summarizer --
export const CHAT_SUMMARIZE_INTERVAL_MS = 10_000;
export const CHAT_MAX_TEXT_LENGTH = 2000;
export const CHAT_SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
export const CHAT_SUMMARY_MAX_TOKENS = 60;

// -- Server --
export const DEFAULT_PORT = 3000;
export const TERMINAL_NAME_PREFIX = 'Claude Code';
