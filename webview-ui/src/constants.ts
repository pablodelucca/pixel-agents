import type { FloorColor } from './office/types.js'

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16
export const DEFAULT_COLS = 20
export const DEFAULT_ROWS = 11
export const MAX_COLS = 64
export const MAX_ROWS = 64

// ── Project Rooms ───────────────────────────────────────────
/** Interior width of auto-generated project rooms (tiles) */
export const ROOM_INTERIOR_WIDTH = 4
/** Interior height of auto-generated project rooms (tiles) */
export const ROOM_INTERIOR_HEIGHT = 3
/** Gap between rooms or between room and existing area (tiles) */
export const ROOM_GAP = 1
/** Default floor color for auto-generated rooms */
export const ROOM_DEFAULT_FLOOR_PATTERN = 1 // FLOOR_1

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48
export const WALK_FRAME_DURATION_SEC = 0.15
export const TYPE_FRAME_DURATION_SEC = 0.3
export const WANDER_PAUSE_MIN_SEC = 2.0
export const WANDER_PAUSE_MAX_SEC = 20.0
export const WANDER_MOVES_BEFORE_REST_MIN = 3
export const WANDER_MOVES_BEFORE_REST_MAX = 6
export const SEAT_REST_MIN_SEC = 120.0
export const SEAT_REST_MAX_SEC = 240.0
export const INTERACT_CHANCE = 0.4
export const INTERACT_EMOJI_DURATION_SEC = 2.5
export const INTERACT_STAY_SEC_MIN = 3.0
export const INTERACT_STAY_SEC_MAX = 8.0

// ── Subagent (kid) ──────────────────────────────────────────
export const SUBAGENT_SCALE = 0.7
export const SUBAGENT_WALK_SPEED_PX_PER_SEC = 80
export const SUBAGENT_WALK_FRAME_DURATION_SEC = 0.08

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3
export const MATRIX_TRAIL_LENGTH = 6
export const MATRIX_SPRITE_COLS = 16
export const MATRIX_SPRITE_ROWS = 24
export const MATRIX_FLICKER_FPS = 30
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3
export const MATRIX_HEAD_COLOR = '#ccffcc'
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6
export const CHARACTER_Z_SORT_OFFSET = 0.5
export const OUTLINE_Z_SORT_OFFSET = 0.001
export const SELECTED_OUTLINE_ALPHA = 1.0
export const HOVERED_OUTLINE_ALPHA = 0.5
export const EXTERNAL_AGENT_OPACITY = 1.0
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5
export const GHOST_PREVIEW_TINT_ALPHA = 0.25
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3]
export const BUTTON_MIN_RADIUS = 6
export const BUTTON_RADIUS_ZOOM_FACTOR = 3
export const BUTTON_ICON_SIZE_FACTOR = 0.45
export const BUTTON_LINE_WIDTH_MIN = 1.5
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5
export const BUBBLE_FADE_DURATION_SEC = 0.5
export const BUBBLE_SITTING_OFFSET_PX = 10
export const BUBBLE_VERTICAL_OFFSET_PX = 24
export const TOOL_EMOJI_SIZE_PX = 10
export const TOOL_EMOJI_BG = 'rgba(30, 30, 46, 0.85)'
export const TOOL_EMOJI_BORDER = '#555566'
export const TOOL_EMOJI_PADDING_PX = 2
export const FALLBACK_FLOOR_COLOR = '#808080'

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)'
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)'
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)'
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)'
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)'
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2]
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)'
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)'
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)'
export const GHOST_VALID_TINT = '#00ff00'
export const GHOST_INVALID_TINT = '#ff0000'
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4'
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)'
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)'

// ── Zone Overlay ────────────────────────────────────────────
export const ZONE_OVERLAY_SATURATION = 70
export const ZONE_OVERLAY_LIGHTNESS = 55
export const ZONE_OVERLAY_ALPHA = 0.45
export const ZONE_LOBBY_OVERLAY_COLOR = 'rgba(255, 255, 255, 0.03)'
export const ZONE_DESATURATE_FILTER = 'saturate(0) brightness(0.6)'

// ── Region Selection ────────────────────────────────────────
export const REGION_SELECT_COLOR = 'rgba(60, 130, 220, 0.3)'
export const REGION_SELECT_STROKE = 'rgba(60, 130, 220, 0.8)'
export const REGION_MOVE_GHOST_ALPHA = 0.4

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1
export const ZOOM_MAX = 10
export const ZOOM_DEFAULT_DPR_FACTOR = 2
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5
export const ZOOM_SCROLL_THRESHOLD = 50
export const PAN_MARGIN_FRACTION = 0.25

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50
export const LAYOUT_SAVE_DEBOUNCE_MS = 500
export const DEFAULT_FLOOR_COLOR: FloorColor = { h: 35, s: 30, b: 15, c: 0 }
export const DEFAULT_WALL_COLOR: FloorColor = { h: 240, s: 25, b: 0, c: 0 }
export const DEFAULT_NEUTRAL_COLOR: FloorColor = { h: 0, s: 0, b: 0, c: 0 }

// ── Notification Sound ──────────────────────────────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25   // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51  // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0
export const NOTIFICATION_NOTE_2_START_SEC = 0.1
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18
export const NOTIFICATION_VOLUME = 0.14

// ── Task Badge ──────────────────────────────────────────────
export const TASK_BADGE_OFFSET_X_PX = 6
export const TASK_BADGE_OFFSET_Y_PX = 20
export const TASK_BADGE_SEG_WIDTH_PX = 2
export const TASK_BADGE_HEIGHT_PX = 5
export const TASK_BADGE_MAX_SEGMENTS = 20
export const TASK_BADGE_BG = '#333344'
export const TASK_BADGE_BORDER = '#555566'
export const TASK_STATUS_COMPLETED_COLOR = '#44BB66'
export const TASK_STATUS_IN_PROGRESS_COLOR = '#44AADD'
export const TASK_STATUS_PENDING_COLOR = '#666677'

// ── Virtual Monitor ─────────────────────────────────────────
export const VIRTUAL_MONITOR_OFFSET_X_PX = 4
export const VIRTUAL_MONITOR_OFFSET_Y_PX = 2
export const VIRTUAL_MONITOR_FRAME_DURATION_SEC = 0.3

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1
export const WAITING_BUBBLE_DURATION_SEC = 2.0
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0
export const PALETTE_COUNT = 6
export const HUE_SHIFT_MIN_DEG = 45
export const HUE_SHIFT_RANGE_DEG = 271
export const AUTO_ON_FACING_DEPTH = 3
export const AUTO_ON_SIDE_DEPTH = 2
export const CHARACTER_HIT_HALF_WIDTH = 8
export const CHARACTER_HIT_HEIGHT = 24
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32
export const PULSE_ANIMATION_DURATION_SEC = 1.5
