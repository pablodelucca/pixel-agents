import { execSync } from 'child_process';
import { TMUX_SESSION_PREFIX } from './constants.js';

let tmuxAvailableCache: boolean | null = null;

/** Check whether tmux is installed and reachable. Result is cached. */
export function isTmuxAvailable(): boolean {
	if (tmuxAvailableCache !== null) return tmuxAvailableCache;
	try {
		execSync('tmux -V', { stdio: 'pipe', timeout: 3000 });
		tmuxAvailableCache = true;
	} catch {
		tmuxAvailableCache = false;
	}
	return tmuxAvailableCache;
}

/** Build a deterministic tmux session name from agent id and session uuid. */
export function buildTmuxSessionName(agentId: number, sessionUuid: string): string {
	return `${TMUX_SESSION_PREFIX}${agentId}-${sessionUuid}`;
}

/** Extract the session UUID from a tmux session name, or null if not matching. */
export function parseSessionUuidFromName(name: string): string | null {
	if (!name.startsWith(TMUX_SESSION_PREFIX)) return null;
	const rest = name.slice(TMUX_SESSION_PREFIX.length);
	// Format: {agentId}-{uuid}  —  uuid contains dashes, agentId is numeric
	const dashIdx = rest.indexOf('-');
	if (dashIdx < 0) return null;
	return rest.slice(dashIdx + 1);
}

/** Parse the agent ID from a tmux session name, or null if not matching. */
export function parseAgentIdFromName(name: string): number | null {
	if (!name.startsWith(TMUX_SESSION_PREFIX)) return null;
	const rest = name.slice(TMUX_SESSION_PREFIX.length);
	const dashIdx = rest.indexOf('-');
	if (dashIdx < 0) return null;
	const idStr = rest.slice(0, dashIdx);
	const id = parseInt(idStr, 10);
	return Number.isFinite(id) ? id : null;
}

/** List all tmux sessions whose name starts with the pixel-agents prefix. */
export function listPixelAgentsSessions(): string[] {
	try {
		const output = execSync("tmux list-sessions -F '#{session_name}'", {
			stdio: 'pipe',
			timeout: 3000,
		}).toString().trim();
		if (!output) return [];
		return output.split('\n').filter(name => name.startsWith(TMUX_SESSION_PREFIX));
	} catch {
		return [];
	}
}

/** Check whether a specific tmux session is still alive. */
export function isTmuxSessionAlive(sessionName: string): boolean {
	try {
		execSync(`tmux has-session -t '${sessionName}'`, { stdio: 'pipe', timeout: 3000 });
		return true;
	} catch {
		return false;
	}
}

/** Kill a tmux session. */
export function killTmuxSession(sessionName: string): void {
	try {
		execSync(`tmux kill-session -t '${sessionName}'`, { stdio: 'pipe', timeout: 3000 });
	} catch {
		// Session may already be dead
	}
}

/** Build a shell command that creates a new tmux session running claude. */
export function buildNewSessionCommand(sessionName: string, sessionUuid: string): string {
	return `tmux new-session -d -s '${sessionName}' 'claude --session-id ${sessionUuid}' && tmux attach-session -t '${sessionName}'`;
}

/** Build a shell command that attaches to an existing tmux session. */
export function buildAttachCommand(sessionName: string): string {
	return `tmux attach-session -t '${sessionName}'`;
}
