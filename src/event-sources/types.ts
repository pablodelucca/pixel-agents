/** Supported event source identifiers. */
export type EventSourceType = 'claude' | 'openclaw';

/**
 * Normalised OpenClaw log entry.
 *
 * `openclaw logs --follow --json` emits one JSON object per line.
 * The schema is intentionally flexible — we probe well-known fields
 * and fall back gracefully when they are absent.
 */
export interface OpenClawLogEntry {
	/** OpenClaw run / session identifier. */
	agentId?: string;
	/** Alternative run-id key used by some OpenClaw builds. */
	run_id?: string;
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
	[key: string]: unknown;
}
