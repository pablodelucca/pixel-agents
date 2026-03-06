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

// ── Project Rooms ────────────────────────────────────────
export const ROOM_WIDTH = 4;
export const ROOM_HEIGHT = 3;

// ── External Session Detection ────────────────────────────
export const EXTERNAL_SESSION_SCAN_INTERVAL_MS = 3000;
export const EXTERNAL_SESSION_STALE_THRESHOLD_MS = 30_000;
export const EXTERNAL_SESSION_REMOVE_THRESHOLD_MS = 300_000;

// ── Settings Persistence ────────────────────────────────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
export const GLOBAL_KEY_SHOW_LABELS_ALWAYS = 'pixel-agents.showLabelsAlways';
export const GLOBAL_KEY_EXTERNAL_SESSIONS_ENABLED = 'pixel-agents.externalSessionsEnabled';
export const GLOBAL_KEY_EXTERNAL_SESSIONS_SCOPE = 'pixel-agents.externalSessionsScope';

// ── Subagent / Task Management Tools ──────────────────────
export const SUBAGENT_TOOL_NAMES = new Set(['Task', 'Agent']);
export const TASK_MGMT_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
export const TERMINAL_NAME_PREFIX = 'Claude Code';

// ── Multiuser Sync ────────────────────────────────────────
export const SYNC_HEARTBEAT_INTERVAL_MS = 1000;
export const SYNC_LAYOUT_POLL_INTERVAL_MS = 3000;
export const SYNC_RECONNECT_BASE_MS = 1000;
export const SYNC_RECONNECT_MAX_MS = 10000;
export const CONFIG_KEY_SERVER_URL = 'pixel-agents.serverUrl';
export const CONFIG_KEY_USER_NAME = 'pixel-agents.userName';
