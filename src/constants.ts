// ── User-Level Layout Persistence ─────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const CONFIG_FILE_NAME = 'config.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';

// ── Settings Persistence (VS Code globalState keys) ─────────
export const GLOBAL_KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
export const GLOBAL_KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
export const GLOBAL_KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
export const GLOBAL_KEY_WATCH_ALL_SESSIONS = 'pixel-agents.watchAllSessions';
export const GLOBAL_KEY_HOOKS_ENABLED = 'pixel-agents.hooksEnabled';
export const GLOBAL_KEY_HOOKS_INFO_SHOWN = 'pixel-agents.hooksInfoShown';

// ── VS Code Identifiers ─────────────────────────────────────
export const VIEW_ID = 'pixel-agents.panelView';
export const COMMAND_SHOW_PANEL = 'pixel-agents.showPanel';
export const COMMAND_EXPORT_DEFAULT_LAYOUT = 'pixel-agents.exportDefaultLayout';
export const COMMAND_DELEGATE_TASK = 'pixel-agents.delegateTask';
export const WORKSPACE_KEY_AGENTS = 'pixel-agents.agents';
export const WORKSPACE_KEY_AGENT_SEATS = 'pixel-agents.agentSeats';
export const WORKSPACE_KEY_LAYOUT = 'pixel-agents.layout';
export const TERMINAL_NAME_PREFIX = 'Claude Code';

// ── Agent Name Refinement (Phase 2) ─────────────────────────
export const NAMER_INITIAL_REFINE_DELAY_MS = 60_000;
export const NAMER_INITIAL_REFINE_MSG_THRESHOLD = 5;
export const NAMER_THROTTLE_MS = 90_000;
export const NAMER_MAX_REFINES_PER_SESSION = 20;
export const NAMER_CLAUDE_TIMEOUT_MS = 30_000;
export const NAMER_TOOL_HISTOGRAM_WINDOW = 30;
export const NAMER_TRANSITION_HISTOGRAM_DELTA = 0.3;
export const NAMER_RECENT_MESSAGES_FOR_PROMPT = 15;
export const NAMER_BULLET_CHAR_LIMIT = 200;
