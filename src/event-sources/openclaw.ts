import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentState } from '../types.js';
import type { OpenClawLogEntry } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tool classification → display status string
// ─────────────────────────────────────────────────────────────────────────────

const DISPLAY_MAX_CMD = 30;

/**
 * Maps an OpenClaw log entry to a human-readable tool status string
 * (same format used by the Claude-mode `formatToolStatus` helper).
 * Returns `null` if the entry does not describe a known tool action.
 */
function classifyToolStatus(entry: OpenClawLogEntry): string | null {
	const tool = (typeof entry.tool === 'string' ? entry.tool : '').toLowerCase();

	if (tool === 'read' || tool === 'web_fetch') {
		const file = typeof entry.file === 'string' ? path.basename(entry.file) : '';
		return file ? `Reading ${file}` : 'Reading\u2026';
	}
	if (tool === 'write' || tool === 'edit') {
		const file = typeof entry.file === 'string' ? path.basename(entry.file) : '';
		return file ? `Editing ${file}` : 'Editing\u2026';
	}
	if (tool === 'exec') {
		const cmd = typeof entry.command === 'string' ? entry.command : '';
		const display = cmd.length > DISPLAY_MAX_CMD
			? cmd.slice(0, DISPLAY_MAX_CMD) + '\u2026'
			: cmd;
		return display ? `Running: ${display}` : 'Running command\u2026';
	}
	return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-run transient state (one entry per OpenClaw agentId)
// ─────────────────────────────────────────────────────────────────────────────

interface RunState {
	/** Pixel Agents numeric agent ID assigned to this OpenClaw run. */
	pixelId: number;
	/** Synthetic tool ID of the currently active tool, or null. */
	activeSyntheticToolId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenClawEventSource
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Observes `openclaw logs --follow --json` and translates log entries into
 * the same webview messages that the Claude JSONL pipeline produces, driving
 * the existing character state machine without any UI changes.
 */
export class OpenClawEventSource {
	private proc: cp.ChildProcess | null = null;
	private lineBuffer = '';
	private toolCounter = 0;
	private disposed = false;

	/** Maps OpenClaw run/agentId → transient pixel-agent state. */
	private readonly runMap = new Map<string, RunState>();

	constructor(
		private readonly nextPixelIdRef: { current: number },
		private readonly agents: Map<number, AgentState>,
		private readonly waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
		private readonly permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
		private webview: vscode.Webview | undefined,
		private readonly agentIdFilter: string | undefined,
		/** Called immediately after a new synthetic pixel agent is registered. */
		private readonly onAgentCreated: (pixelId: number) => void,
	) {}

	// ── Public API ──────────────────────────────────────────────────────────

	/** Update the webview reference when it becomes available or is recreated. */
	setWebview(wv: vscode.Webview | undefined): void {
		this.webview = wv;
	}

	/** Spawn the openclaw process and begin processing log lines. */
	start(): void {
		this.spawnProcess();
	}

	dispose(): void {
		this.disposed = true;
		if (this.proc) {
			this.proc.kill();
			this.proc = null;
		}
		this.runMap.clear();
	}

	// ── Process management ──────────────────────────────────────────────────

	private spawnProcess(): void {
		if (this.disposed) { return; }

		let proc: cp.ChildProcess;
		try {
			proc = cp.spawn('openclaw', ['logs', '--follow', '--json'], {
				stdio: ['ignore', 'pipe', 'pipe'],
				detached: false,
			});
		} catch (err) {
			console.error('[Pixel Agents / OpenClaw] Failed to spawn openclaw process:', err);
			this.handleProcessUnavailable();
			return;
		}

		this.proc = proc;
		console.log(`[Pixel Agents / OpenClaw] Process started (PID ${proc.pid ?? 'unknown'})`);

		proc.stdout?.setEncoding('utf-8');
		proc.stdout?.on('data', (chunk: string) => { this.handleChunk(chunk); });

		proc.stderr?.setEncoding('utf-8');
		proc.stderr?.on('data', (chunk: string) => {
			console.warn('[Pixel Agents / OpenClaw] stderr:', chunk.trim());
		});

		proc.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'ENOENT') {
				console.error('[Pixel Agents / OpenClaw] `openclaw` binary not found.');
				this.handleProcessUnavailable();
			} else {
				console.error('[Pixel Agents / OpenClaw] Process error:', err.message);
				this.scheduleRestart();
			}
		});

		proc.on('close', (code) => {
			console.log(`[Pixel Agents / OpenClaw] Process exited (code ${code ?? 'null'})`);
			this.proc = null;
			this.scheduleRestart();
		});
	}

	private scheduleRestart(): void {
		if (this.disposed) { return; }
		setTimeout(() => {
			if (!this.disposed) {
				console.log('[Pixel Agents / OpenClaw] Restarting process\u2026');
				this.spawnProcess();
			}
		}, 3000);
	}

	private handleProcessUnavailable(): void {
		vscode.window.showWarningMessage(
			'Pixel Agents: `openclaw` command not found in PATH. ' +
			'Ensure OpenClaw is installed, then reload the window.',
		);
	}

	// ── Line parsing ────────────────────────────────────────────────────────

	private handleChunk(chunk: string): void {
		const text = this.lineBuffer + chunk;
		const lines = text.split('\n');
		this.lineBuffer = lines.pop() ?? '';
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed) { this.processLine(trimmed); }
		}
	}

	private processLine(line: string): void {
		let raw: OpenClawLogEntry;
		try {
			raw = JSON.parse(line) as OpenClawLogEntry;
		} catch {
			// Non-JSON line (e.g. startup banner) — ignore silently.
			return;
		}

		// ── Priority 1: native `pa` envelope emitted by the Pixel Agents skill ──
		// Format: { "type": "pa", "agentId": "...", "tool": "read", ... }
		// or:     { "type": "pa", "pa": { "agentId": "...", ... } }
		if (raw.type === 'pa') {
			const payload: OpenClawLogEntry = raw.pa
				? { ...raw.pa as OpenClawLogEntry }
				: raw;
			this.dispatchEntry(payload);
			return;
		}

		// ── Priority 2: native OpenClaw log envelope (type: "log") ─────────────
		// Format: { "type": "log", "subsystem": "agent", "message": "...", "sessionKey": "agent:main:session:abc" }
		// We extract agentId from sessionKey and look for tool info in message.
		if (raw.type === 'log' && typeof raw.sessionKey === 'string') {
			const nativeEntry = this.extractFromNativeLog(raw);
			if (nativeEntry) { this.dispatchEntry(nativeEntry); }
			return;
		}

		// ── Priority 3: compact flat format (direct emit, no envelope) ─────────
		// Format: { "agentId": "...", "tool": "read", "status": "start" }
		this.dispatchEntry(raw);
	}

	/**
	 * Extracts a Pixel Agents event from a native OpenClaw log envelope.
	 * Parses the `sessionKey` for the agentId and the `message` for tool hints.
	 */
	private extractFromNativeLog(raw: OpenClawLogEntry): OpenClawLogEntry | null {
		// sessionKey format: "agent:<agentName>:session:<sessionId>" or similar
		const sessionKey = raw.sessionKey as string;
		const keyParts = sessionKey.split(':');
		// Heuristic: last segment is the session/run ID used as agentId
		const openclawId = raw.agentId as string | undefined
			?? keyParts[keyParts.length - 1]
			?? undefined;

		if (!openclawId) { return null; }

		const msg = (typeof raw.message === 'string' ? raw.message : '').toLowerCase();
		const subsystem = (typeof raw.subsystem === 'string' ? raw.subsystem : '').toLowerCase();

		// Heuristic mapping from native log messages to PA events
		// "Tool call: read" / "Invoking tool read" / "exec: npm test"
		const toolMatch = msg.match(/\b(?:tool[^:]*:\s*|invoking\s+tool\s+)(\w+)/i)
			?? msg.match(/^(read|write|edit|exec|web_fetch)\b/i);
		if (toolMatch) {
			return {
				agentId: openclawId,
				tool: toolMatch[1].toLowerCase(),
				status: msg.includes('complet') || msg.includes('done') || msg.includes('finish') ? 'end' : 'start',
			};
		}

		// Lifecycle events from subsystem messages
		if (subsystem === 'agent' || subsystem === 'session') {
			if (msg.includes('start') || msg.includes('register') || msg.includes('init')) {
				return { agentId: openclawId, event: 'run_registered' };
			}
			if (msg.includes('end') || msg.includes('done') || msg.includes('complete') || msg.includes('clear')) {
				return { agentId: openclawId, event: 'run_cleared' };
			}
			if (msg.includes('error') || msg.includes('fail') || msg.includes('timeout')) {
				return { agentId: openclawId, event: 'error' };
			}
		}

		return null;
	}

	/**
	 * Dispatches a normalised entry (from any format) to the appropriate handler.
	 */
	private dispatchEntry(entry: OpenClawLogEntry): void {
		// Resolve agentId — accept both `agentId` and `run_id` keys.
		const openclawId =
			typeof entry.agentId === 'string' ? entry.agentId :
				typeof entry.run_id === 'string' ? entry.run_id :
					undefined;

		if (!openclawId) { return; }

		// Apply optional filter.
		if (this.agentIdFilter !== undefined && openclawId !== this.agentIdFilter) { return; }

		const evt = (typeof entry.event === 'string' ? entry.event : '').toLowerCase();
		const status = (typeof entry.status === 'string' ? entry.status : '').toLowerCase();
		const tool = (typeof entry.tool === 'string' ? entry.tool : '').toLowerCase();

		// ── Lifecycle events ──────────────────────────────────────────────────
		if (evt === 'run_registered' || status === 'registered') {
			this.handleRunRegistered(openclawId);
			return;
		}
		if (evt === 'run_cleared' || status === 'cleared') {
			this.handleRunCleared(openclawId);
			return;
		}
		if (evt === 'error' || evt === 'timeout' || status === 'error' || status === 'timeout') {
			this.handleError(openclawId);
			return;
		}

		// ── Tool events ───────────────────────────────────────────────────────
		if (tool) {
			const toolStatus = classifyToolStatus(entry);
			if (!toolStatus) { return; }

			const isEnd =
				status === 'end' || status === 'done' ||
				status === 'complete' || status === 'completed';

			if (isEnd) {
				this.handleToolEnd(openclawId);
			} else {
				this.handleToolStart(openclawId, entry, toolStatus);
			}
		}
	}

	// ── Event handlers ──────────────────────────────────────────────────────

	private handleRunRegistered(openclawId: string): void {
		console.log(`[Pixel Agents / OpenClaw] run_registered: ${openclawId}`);
		const state = this.getOrCreateRun(openclawId);
		this.clearSyntheticTool(state.pixelId, state);
		this.webview?.postMessage({ type: 'agentStatus', id: state.pixelId, status: 'active' });
	}

	private handleRunCleared(openclawId: string): void {
		console.log(`[Pixel Agents / OpenClaw] run_cleared: ${openclawId}`);
		const state = this.runMap.get(openclawId);
		if (!state) { return; }
		this.clearSyntheticTool(state.pixelId, state);
		const agent = this.agents.get(state.pixelId);
		if (agent) { agent.isWaiting = true; }
		this.webview?.postMessage({ type: 'agentStatus', id: state.pixelId, status: 'waiting' });
	}

	private handleError(openclawId: string): void {
		console.log(`[Pixel Agents / OpenClaw] error/timeout: ${openclawId}`);
		const state = this.getOrCreateRun(openclawId);
		const agent = this.agents.get(state.pixelId);
		if (agent && !agent.permissionSent) {
			agent.permissionSent = true;
			this.webview?.postMessage({ type: 'agentToolPermission', id: state.pixelId });
		}
	}

	private handleToolStart(
		openclawId: string,
		entry: OpenClawLogEntry,
		toolStatus: string,
	): void {
		console.log(`[Pixel Agents / OpenClaw] tool start (${entry.tool}) for ${openclawId}: ${toolStatus}`);
		const state = this.getOrCreateRun(openclawId);
		const agent = this.agents.get(state.pixelId);
		if (!agent) { return; }

		// Clear the previous synthetic tool (OpenClaw tracks one at a time).
		this.clearSyntheticTool(state.pixelId, state);

		// Start new synthetic tool.
		const toolId = `oc-tool-${++this.toolCounter}`;
		state.activeSyntheticToolId = toolId;
		agent.activeToolIds.add(toolId);
		agent.activeToolStatuses.set(toolId, toolStatus);
		agent.activeToolNames.set(toolId, typeof entry.tool === 'string' ? entry.tool : 'unknown');
		agent.isWaiting = false;

		this.webview?.postMessage({ type: 'agentStatus', id: state.pixelId, status: 'active' });
		this.webview?.postMessage({ type: 'agentToolStart', id: state.pixelId, toolId, status: toolStatus });
	}

	private handleToolEnd(openclawId: string): void {
		console.log(`[Pixel Agents / OpenClaw] tool end for ${openclawId}`);
		const state = this.runMap.get(openclawId);
		if (state) { this.clearSyntheticTool(state.pixelId, state); }
	}

	// ── Helpers ─────────────────────────────────────────────────────────────

	/**
	 * Returns the RunState for a given openclawId, creating a new synthetic
	 * pixel agent if this is the first time we see this run.
	 */
	private getOrCreateRun(openclawId: string): RunState {
		const existing = this.runMap.get(openclawId);
		if (existing) { return existing; }

		const pixelId = this.nextPixelIdRef.current++;
		const syntheticAgent: AgentState = {
			id: pixelId,
			terminalRef: undefined,
			openclawAgentId: openclawId,
			projectDir: '',
			jsonlFile: '',
			fileOffset: 0,
			lineBuffer: '',
			activeToolIds: new Set(),
			activeToolStatuses: new Map(),
			activeToolNames: new Map(),
			activeSubagentToolIds: new Map(),
			activeSubagentToolNames: new Map(),
			isWaiting: false,
			permissionSent: false,
			hadToolsInTurn: false,
		};

		this.agents.set(pixelId, syntheticAgent);

		const state: RunState = { pixelId, activeSyntheticToolId: null };
		this.runMap.set(openclawId, state);

		console.log(`[Pixel Agents / OpenClaw] Created pixel agent ${pixelId} for run "${openclawId}"`);
		this.onAgentCreated(pixelId);
		this.webview?.postMessage({ type: 'agentCreated', id: pixelId });

		return state;
	}

	/**
	 * Removes the active synthetic tool from agent state and posts an
	 * `agentToolDone` message (with the standard 300 ms visual delay).
	 */
	private clearSyntheticTool(pixelId: number, state: RunState): void {
		const toolId = state.activeSyntheticToolId;
		if (!toolId) { return; }

		const agent = this.agents.get(pixelId);
		if (agent) {
			agent.activeToolIds.delete(toolId);
			agent.activeToolStatuses.delete(toolId);
			agent.activeToolNames.delete(toolId);
		}

		state.activeSyntheticToolId = null;

		// Mirror the 300 ms delay used in the Claude pipeline (TOOL_DONE_DELAY_MS).
		setTimeout(() => {
			this.webview?.postMessage({ type: 'agentToolDone', id: pixelId, toolId });
		}, 300);
	}
}
