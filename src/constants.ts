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
export const CONFIG_FILE_NAME = 'config.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';

// ── Settings Persistence ────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const COMMAND_START_MCP_SERVER = 'pixel-agents.startMcpServer';
export const COMMAND_STOP_MCP_SERVER = 'pixel-agents.stopMcpServer';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
export const TERMINAL_NAME_PREFIX = 'Claude Code';

// ── Copilot Integration ─────────────────────────────────────
export const COPILOT_TERMINAL_PREFIX_DEFAULT = 'Copilot';
export const COPILOT_ACTIVITY_POLL_MS = 500;

// ── MCP Server ──────────────────────────────────────────────
export const MCP_DEFAULT_PORT = 3100;
export const MCP_SERVER_NAME = 'pixel-agents-mcp';
export const MCP_SERVER_VERSION = '1.0.0';

// ── Telegram ────────────────────────────────────────────────
export const TELEGRAM_POLL_INTERVAL_MS = 2000;
export const TELEGRAM_API_BASE = 'https://api.telegram.org';
