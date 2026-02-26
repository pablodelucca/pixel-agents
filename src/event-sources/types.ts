/** Supported event source identifiers. */
export type EventSourceType = 'claude' | 'openclaw';

// ─────────────────────────────────────────────────────────────────────────────
// Native OpenClaw log format
// (`openclaw logs --follow --json` emits one of these per line)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envelope type field emitted by `openclaw logs --follow --json`.
 *
 * - `"meta"`   — Stream metadata (cursor, file path, size)
 * - `"log"`    — Parsed structured log entry
 * - `"notice"` — Truncation / rotation hint
 * - `"raw"`    — Fallback unparsed line
 * - `"pa"`     — Pixel Agents structured event (emitted by the PA skill)
 */
export type OpenClawEnvelopeType = 'meta' | 'log' | 'notice' | 'raw' | 'pa';

/** Native log-level values used by OpenClaw. */
export type OpenClawLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * A single line emitted by `openclaw logs --follow --json`.
 *
 * OpenClaw wraps every log line in an envelope with a `type` discriminator.
 * The Pixel Agents parser supports both the native format and the compact
 * event format that the PA skill instructs the AI to emit.
 */
export interface OpenClawNativeLogLine {
	/** Envelope discriminator. */
	type: OpenClawEnvelopeType;
	/** ISO-8601 timestamp (present on most types). */
	timestamp?: string;
	/** Log level (on `"log"` entries). */
	level?: OpenClawLogLevel;
	/** Source subsystem, e.g. `"agent"`, `"tool"`, `"gateway"`. */
	subsystem?: string;
	/** Human-readable message (on `"log"` entries). */
	message?: string;
	/** Session / run key, e.g. `"agent:main:session:<id>"`. */
	sessionKey?: string;
	/** OpenClaw agentId extracted from sessionKey when available. */
	agentId?: string;
	/**
	 * Pixel Agents structured event payload.
	 * Present when `type === "pa"` (emitted by the Pixel Agents skill).
	 */
	pa?: OpenClawPixelAgentsEvent;
	[key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixel Agents structured event (compact format for the PA skill)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compact Pixel Agents event emitted by the PA skill via exec/echo.
 *
 * The skill instructs the AI to output one JSON line per state change:
 *   `{"type":"pa","agentId":"<id>","event":"run_registered"}`
 *   `{"type":"pa","agentId":"<id>","tool":"read","file":"main.ts","status":"start"}`
 *
 * These lines appear in the `openclaw logs --follow --json` stream and are
 * picked up by the Pixel Agents event source.
 */
export interface OpenClawPixelAgentsEvent {
	/** OpenClaw run / session identifier. */
	agentId: string;
	/**
	 * Tool being invoked.
	 * Known values: "read", "write", "edit", "exec", "web_fetch".
	 */
	tool?: string;
	/**
	 * Lifecycle event discriminator.
	 * Known values: "run_registered", "run_cleared", "error", "timeout".
	 */
	event?: string;
	/**
	 * Start / end discriminator for tool events.
	 * Known values: "start", "end", "done", "complete".
	 */
	status?: string;
	/** Target file path for file-based tools. */
	file?: string;
	/** Shell command string for exec tools. */
	command?: string;
	/** Human-readable error message. */
	message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flexible legacy / compact format (union for parser convenience)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of all parseable formats.  The parser tries each shape in order:
 *  1. Native envelope with `type: "pa"` and a `pa` payload.
 *  2. Native envelope with `type: "log"` — tool events extracted from message.
 *  3. Compact flat format (legacy / direct emit without envelope).
 */
export interface OpenClawLogEntry {
	/** OpenClaw run / session identifier (compact format). */
	agentId?: string;
	/** Alternative run-id key used by some OpenClaw builds. */
	run_id?: string;
	/** Native envelope type (present in the native format). */
	type?: string;
	/** Native log level. */
	level?: string;
	/** Native subsystem. */
	subsystem?: string;
	/**
	 * Tool being invoked (compact format).
	 * Known values: "read", "write", "edit", "exec", "web_fetch".
	 */
	tool?: string;
	/**
	 * Lifecycle event discriminator (compact format).
	 * Known values: "run_registered", "run_cleared", "error", "timeout".
	 */
	event?: string;
	/**
	 * Start / end discriminator for tool events.
	 * Known values: "start", "end", "done", "complete", "completed",
	 * "registered", "cleared", "error", "timeout".
	 */
	status?: string;
	/** Target file path for file-based tools (read / write / edit). */
	file?: string;
	/** Shell command string for exec tools. */
	command?: string;
	/** Per-invocation correlation ID emitted by some OpenClaw builds. */
	toolId?: string | number;
	/** Human-readable error or event description. */
	message?: string;
	/** Pixel Agents structured payload (native `pa` envelope). */
	pa?: OpenClawPixelAgentsEvent;
	/** Session key for extracting agentId from native format. */
	sessionKey?: string;
	[key: string]: unknown;
}
