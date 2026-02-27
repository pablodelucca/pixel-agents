import { execFileSync } from 'child_process';
import * as path from 'path';

const MAX_TREE_WALK_DEPTH = 10;

/** Check if tmux is available on the system */
export function isTmuxAvailable(): boolean {
	try {
		execFileSync('which', ['tmux'], { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/** Hash a workspace path the same way Claude does: replace :/\/ with - */
function hashWorkspacePath(wsPath: string): string {
	return wsPath.replace(/[:\\/]/g, '-');
}

/** Find PIDs of `claude` processes whose cwd matches the project dir hash */
export function findClaudePidsForProject(projectDir: string): number[] {
	// Extract the hash from the project dir path (last component)
	const expectedHash = path.basename(projectDir);

	try {
		const output = execFileSync('pgrep', ['-x', 'claude'], {
			stdio: 'pipe',
			encoding: 'utf-8',
		}).trim();
		if (!output) return [];

		const pids = output.split('\n').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
		const matches: number[] = [];

		for (const pid of pids) {
			try {
				const lsofOutput = execFileSync('lsof', ['-p', String(pid), '-Fn'], {
					stdio: 'pipe',
					encoding: 'utf-8',
				});
				// lsof -Fn outputs lines like "fcwd\nn/path/to/dir"
				const lines = lsofOutput.split('\n');
				for (let i = 0; i < lines.length; i++) {
					if (lines[i] === 'fcwd' && i + 1 < lines.length && lines[i + 1].startsWith('n')) {
						const cwd = lines[i + 1].slice(1);
						if (hashWorkspacePath(cwd) === expectedHash) {
							matches.push(pid);
						}
						break;
					}
				}
			} catch {
				// Process may have exited
			}
		}
		return matches;
	} catch {
		return [];
	}
}

/** Get the parent PID of a given process */
export function getParentPid(pid: number): number | null {
	try {
		const output = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], {
			stdio: 'pipe',
			encoding: 'utf-8',
		}).trim();
		const ppid = parseInt(output, 10);
		return isNaN(ppid) || ppid <= 1 ? null : ppid;
	} catch {
		return null;
	}
}

/** Parse `tmux list-panes` output into a Map of pane_pid → session_name */
export function getTmuxPanePids(): Map<number, string> {
	const result = new Map<number, string>();
	try {
		const output = execFileSync('tmux', ['list-panes', '-a', '-F', '#{pane_pid} #{session_name}'], {
			stdio: 'pipe',
			encoding: 'utf-8',
		}).trim();
		if (!output) return result;
		for (const line of output.split('\n')) {
			const spaceIdx = line.indexOf(' ');
			if (spaceIdx === -1) continue;
			const pid = parseInt(line.slice(0, spaceIdx), 10);
			const sessionName = line.slice(spaceIdx + 1);
			if (!isNaN(pid) && sessionName) {
				result.set(pid, sessionName);
			}
		}
	} catch {
		// tmux not running or no sessions
	}
	return result;
}

/** Walk the process tree upward from `pid` looking for a tmux pane PID */
export function findTmuxSessionForPid(pid: number, panePids: Map<number, string>): string | null {
	let current: number | null = pid;
	for (let i = 0; i < MAX_TREE_WALK_DEPTH && current !== null; i++) {
		const session = panePids.get(current);
		if (session) return session;
		current = getParentPid(current);
	}
	return null;
}

// ── Tmux session/window management ─────────────────────────

/** Check if a tmux session exists */
export function tmuxSessionExists(sessionName: string): boolean {
	try {
		execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/** Create a new tmux session (detached) with an initial window */
export function createTmuxSession(sessionName: string, windowName: string, cwd: string): void {
	execFileSync('tmux', ['new-session', '-d', '-s', sessionName, '-n', windowName, '-c', cwd], {
		stdio: 'pipe',
	});
}

/** Create a new window in an existing tmux session */
export function createTmuxWindow(sessionName: string, windowName: string, cwd: string): void {
	execFileSync('tmux', ['new-window', '-t', sessionName, '-n', windowName, '-c', cwd], {
		stdio: 'pipe',
	});
}

/** Send keys to a tmux window */
export function tmuxSendKeys(sessionName: string, windowName: string, keys: string): void {
	execFileSync('tmux', ['send-keys', '-t', `${sessionName}:${windowName}`, keys, 'Enter'], {
		stdio: 'pipe',
	});
}

/** Kill a tmux window */
export function killTmuxWindow(sessionName: string, windowName: string): void {
	try {
		execFileSync('tmux', ['kill-window', '-t', `${sessionName}:${windowName}`], {
			stdio: 'pipe',
		});
	} catch {
		// Window may already be gone
	}
}

/** Orchestrate: agent project dir → tmux session name (or null) */
export function resolveTmuxSession(projectDir: string): string | null {
	const claudePids = findClaudePidsForProject(projectDir);
	if (claudePids.length === 0) return null;

	const panePids = getTmuxPanePids();
	if (panePids.size === 0) return null;

	// Try each Claude PID — first one that matches a tmux session wins
	for (const claudePid of claudePids) {
		const session = findTmuxSessionForPid(claudePid, panePids);
		if (session) return session;
	}

	return null;
}
