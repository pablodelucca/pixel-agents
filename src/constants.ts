// ── Timing (ms) ──────────────────────────────────────────────
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 2000;
export const PROJECT_SCAN_INTERVAL_MS = 1000;
export const TOOL_DONE_DELAY_MS = 300;
export const PERMISSION_TIMER_DELAY_MS = 7000;
export const PERMISSION_TIMER_SHELL_DELAY_MS = 15000;
export const TEXT_IDLE_DELAY_MS = 5000;

// ── Display Truncation ──────────────────────────────────────
export const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
export const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;

// ── PNG / Asset Parsing ─────────────────────────────────────
export const PNG_ALPHA_THRESHOLD = 128;
export const WALL_PIECE_WIDTH = 16;
export const WALL_PIECE_HEIGHT = 32;
export const WALL_GRID_COLS = 4;
export const WALL_BITMASK_COUNT = 16;
export const FLOOR_PATTERN_COUNT = 7;
export const FLOOR_TILE_SIZE = 16;
export const CHARACTER_DIRECTIONS = ['down', 'up', 'right'] as const;
export const CHAR_FRAME_W = 16;
export const CHAR_FRAME_H = 32;
export const CHAR_FRAMES_PER_ROW = 7;
export const CHAR_COUNT = 6;

// ── User-Level Layout Persistence ─────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;

// ── Settings Persistence ────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';

// ── Settings Keys ────────────────────────────────────────────
export const SETTING_CLI_PROVIDER = 'pixel-agents.cliProvider';
export const SETTING_CLAUDE_COMMAND = 'pixel-agents.claudeCommand';

// ── Provider Constants ───────────────────────────────────────
export const CLI_PROVIDER_CLAUDE = 'claude';
export const CLI_PROVIDER_CODEX = 'codex';
export const TERMINAL_NAME_PREFIX_CLAUDE = 'Claude Code';
export const TERMINAL_NAME_PREFIX_CODEX = 'Codex CLI';
export const TERMINAL_NAME_PREFIX = TERMINAL_NAME_PREFIX_CLAUDE;
export const CLAUDE_PROJECTS_SUBDIR = '.claude/projects';
export const CODEX_HOME_SUBDIR = '.codex';
export const CODEX_SESSIONS_SUBDIR = 'sessions';
export const CODEX_SCAN_ADJACENT_DAYS = 1;
export const CODEX_SESSION_META_READ_CHUNK_BYTES = 16384;
export const CODEX_SESSION_META_READ_MAX_BYTES = 1048576;
