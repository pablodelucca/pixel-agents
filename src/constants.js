"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TERMINAL_NAME_PREFIX = exports.WORKSPACE_KEY_LAYOUT = exports.WORKSPACE_KEY_AGENT_SEATS = exports.WORKSPACE_KEY_AGENTS = exports.COMMAND_EXPORT_DEFAULT_LAYOUT = exports.COMMAND_SHOW_PANEL = exports.VIEW_ID = exports.GLOBAL_KEY_EXTERNAL_SESSIONS_SCOPE = exports.GLOBAL_KEY_EXTERNAL_SESSIONS_ENABLED = exports.GLOBAL_KEY_SHOW_LABELS_ALWAYS = exports.GLOBAL_KEY_SOUND_ENABLED = exports.EXTERNAL_SESSION_REMOVE_THRESHOLD_MS = exports.EXTERNAL_SESSION_STALE_THRESHOLD_MS = exports.EXTERNAL_SESSION_SCAN_INTERVAL_MS = exports.ROOM_HEIGHT = exports.ROOM_WIDTH = exports.LAYOUT_FILE_POLL_INTERVAL_MS = exports.LAYOUT_FILE_NAME = exports.LAYOUT_FILE_DIR = exports.CHAR_COUNT = exports.CHAR_FRAMES_PER_ROW = exports.CHAR_FRAME_H = exports.CHAR_FRAME_W = exports.CHARACTER_DIRECTIONS = exports.FLOOR_TILE_SIZE = exports.FLOOR_PATTERN_COUNT = exports.WALL_BITMASK_COUNT = exports.WALL_GRID_COLS = exports.WALL_PIECE_HEIGHT = exports.WALL_PIECE_WIDTH = exports.PNG_ALPHA_THRESHOLD = exports.TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = exports.BASH_COMMAND_DISPLAY_MAX_LENGTH = exports.TEXT_IDLE_DELAY_MS = exports.PERMISSION_TIMER_DELAY_MS = exports.TOOL_DONE_DELAY_MS = exports.PROJECT_SCAN_INTERVAL_MS = exports.FILE_WATCHER_POLL_INTERVAL_MS = exports.JSONL_POLL_INTERVAL_MS = void 0;
// ── Timing (ms) ──────────────────────────────────────────────
exports.JSONL_POLL_INTERVAL_MS = 1000;
exports.FILE_WATCHER_POLL_INTERVAL_MS = 1000;
exports.PROJECT_SCAN_INTERVAL_MS = 1000;
exports.TOOL_DONE_DELAY_MS = 300;
exports.PERMISSION_TIMER_DELAY_MS = 7000;
exports.TEXT_IDLE_DELAY_MS = 5000;
// ── Display Truncation ──────────────────────────────────────
exports.BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
exports.TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;
// ── PNG / Asset Parsing ─────────────────────────────────────
exports.PNG_ALPHA_THRESHOLD = 128;
exports.WALL_PIECE_WIDTH = 16;
exports.WALL_PIECE_HEIGHT = 32;
exports.WALL_GRID_COLS = 4;
exports.WALL_BITMASK_COUNT = 16;
exports.FLOOR_PATTERN_COUNT = 7;
exports.FLOOR_TILE_SIZE = 16;
exports.CHARACTER_DIRECTIONS = ['down', 'up', 'right'];
exports.CHAR_FRAME_W = 16;
exports.CHAR_FRAME_H = 32;
exports.CHAR_FRAMES_PER_ROW = 7;
exports.CHAR_COUNT = 6;
// ── User-Level Layout Persistence ─────────────────────────────
exports.LAYOUT_FILE_DIR = '.pixel-agents';
exports.LAYOUT_FILE_NAME = 'layout.json';
exports.LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
// ── Project Rooms ────────────────────────────────────────
exports.ROOM_WIDTH = 4;
exports.ROOM_HEIGHT = 3;
// ── External Session Detection ────────────────────────────
exports.EXTERNAL_SESSION_SCAN_INTERVAL_MS = 3000;
exports.EXTERNAL_SESSION_STALE_THRESHOLD_MS = 30_000;
exports.EXTERNAL_SESSION_REMOVE_THRESHOLD_MS = 300_000;
// ── Settings Persistence ────────────────────────────────────
exports.GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
exports.GLOBAL_KEY_SHOW_LABELS_ALWAYS = 'pixel-agents.showLabelsAlways';
exports.GLOBAL_KEY_EXTERNAL_SESSIONS_ENABLED = 'pixel-agents.externalSessionsEnabled';
exports.GLOBAL_KEY_EXTERNAL_SESSIONS_SCOPE = 'pixel-agents.externalSessionsScope';
// ── VS Code Identifiers ─────────────────────────────────────
exports.VIEW_ID = 'pixel-agents.panelView';
exports.COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
exports.COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
exports.WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
exports.WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
exports.WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
exports.TERMINAL_NAME_PREFIX = 'Claude Code';
//# sourceMappingURL=constants.js.map