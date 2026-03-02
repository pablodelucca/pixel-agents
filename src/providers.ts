import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { AgentProvider, SessionFormat } from './types.js';

export interface ProviderLaunchMeta {
	sessionId?: string;
	launchedAt: number;
}

export interface ProviderDefinition {
	id: AgentProvider;
	label: string;
	terminalPrefix: string;
	sessionFormat: SessionFormat;
	commandForLaunch: (sessionId?: string) => string;
	getProjectDirPath: (cwd?: string) => string | null;
	resolveSessionFile: (
		cwd: string,
		launchMeta: ProviderLaunchMeta,
		claimedFiles: Set<string>,
	) => string | null;
}

function isWindows(): boolean {
	return process.platform === 'win32';
}

function commandExists(command: string): boolean {
	const checker = isWindows() ? 'where' : 'which';
	const result = spawnSync(checker, [command], { stdio: 'ignore', shell: true });
	return result.status === 0;
}

function normalizePathForCompare(p: string): string {
	return path.resolve(p).toLowerCase();
}

function findNewestFiles(root: string, predicate: (f: string) => boolean, maxFiles = 400): string[] {
	const files: Array<{ file: string; mtime: number }> = [];
	const stack: string[] = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (!entry.isFile() || !predicate(full)) continue;
			try {
				const stat = fs.statSync(full);
				files.push({ file: full, mtime: stat.mtimeMs });
			} catch {
				// ignore
			}
		}
	}
	files.sort((a, b) => b.mtime - a.mtime);
	return files.slice(0, maxFiles).map(f => f.file);
}

function resolveClaudeProjectDir(cwd?: string): string | null {
	if (!cwd) return null;
	const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
	return path.join(os.homedir(), '.claude', 'projects', dirName);
}

function resolveCodexProjectDir(): string {
	return path.join(os.homedir(), '.codex', 'sessions');
}

function resolveGeminiProjectDir(): string {
	return path.join(os.homedir(), '.gemini', 'tmp');
}

function resolveClaudeSessionFile(cwd: string, launchMeta: ProviderLaunchMeta): string | null {
	const projectDir = resolveClaudeProjectDir(cwd);
	if (!projectDir || !launchMeta.sessionId) return null;
	return path.join(projectDir, `${launchMeta.sessionId}.jsonl`);
}

function resolveCodexSessionFile(cwd: string, launchMeta: ProviderLaunchMeta, claimedFiles: Set<string>): string | null {
	const root = resolveCodexProjectDir();
	if (!fs.existsSync(root)) return null;
	const candidates = findNewestFiles(root, f => path.basename(f).startsWith('rollout-') && f.endsWith('.jsonl'));
	const cwdNorm = normalizePathForCompare(cwd);
	let bestUnclaimed: { file: string; delta: number } | null = null;
	let bestClaimed: { file: string; delta: number } | null = null;
	let fallbackUnclaimed: { file: string; delta: number } | null = null;
	let fallbackClaimed: { file: string; delta: number } | null = null;

	for (const file of candidates) {
		const isClaimed = claimedFiles.has(file);
		const stat = fs.statSync(file);
		if (stat.mtimeMs < launchMeta.launchedAt - 120000) continue;
		const delta = Math.abs(stat.mtimeMs - launchMeta.launchedAt);
		if (isClaimed) {
			if (!fallbackClaimed || delta < fallbackClaimed.delta) {
				fallbackClaimed = { file, delta };
			}
		} else {
			if (!fallbackUnclaimed || delta < fallbackUnclaimed.delta) {
				fallbackUnclaimed = { file, delta };
			}
		}

		let lineCount = 0;
		let fileCwd: string | null = null;
		try {
			const content = fs.readFileSync(file, 'utf-8');
			const lines = content.split('\n');
			for (const line of lines) {
				if (!line.trim()) continue;
				lineCount++;
				if (lineCount > 30) break;
				const parsed = JSON.parse(line) as Record<string, unknown>;
				if (parsed.type === 'session_meta') {
					const payload = parsed.payload as Record<string, unknown> | undefined;
					const pcwd = payload?.cwd;
					if (typeof pcwd === 'string') {
						fileCwd = normalizePathForCompare(pcwd);
					}
					break;
				}
			}
		} catch {
			continue;
		}

		if (!fileCwd || fileCwd !== cwdNorm) continue;
		if (isClaimed) {
			if (!bestClaimed || delta < bestClaimed.delta) bestClaimed = { file, delta };
		} else {
			if (!bestUnclaimed || delta < bestUnclaimed.delta) bestUnclaimed = { file, delta };
		}
	}
	// Prefer exact cwd unclaimed, then exact cwd claimed, then nearest unclaimed, then nearest claimed.
	return bestUnclaimed?.file ?? bestClaimed?.file ?? fallbackUnclaimed?.file ?? fallbackClaimed?.file ?? null;
}

function resolveGeminiSessionFile(cwd: string, launchMeta: ProviderLaunchMeta, claimedFiles: Set<string>): string | null {
	const root = resolveGeminiProjectDir();
	if (!fs.existsSync(root)) return null;
	const cwdNorm = normalizePathForCompare(cwd);
	const projectRoots = findNewestFiles(root, f => path.basename(f) === '.project_root', 500);
	const candidateDirs = new Set<string>();

	for (const pr of projectRoots) {
		try {
			const content = fs.readFileSync(pr, 'utf-8').trim();
			const normalized = normalizePathForCompare(content);
			if (normalized === cwdNorm) {
				candidateDirs.add(path.dirname(pr));
			}
		} catch {
			// ignore
		}
	}
	// Common local format: ~/.gemini/tmp/<workspace-name>/chats/session-*.json
	candidateDirs.add(path.join(root, path.basename(cwd)));

	let bestUnclaimed: { file: string; delta: number } | null = null;
	let bestClaimed: { file: string; delta: number } | null = null;
	let bestCandidateAnyUnclaimed: { file: string; mtime: number } | null = null;
	let bestCandidateAnyClaimed: { file: string; mtime: number } | null = null;
	for (const dir of candidateDirs) {
		const chatsDir = path.join(dir, 'chats');
		if (!fs.existsSync(chatsDir)) continue;
		let entries: string[];
		try {
			entries = fs.readdirSync(chatsDir).filter(f => /^session-.*\.json$/.test(f));
		} catch {
			continue;
		}
		for (const name of entries) {
			const full = path.join(chatsDir, name);
			const isClaimed = claimedFiles.has(full);
			let stat: fs.Stats;
			try {
				stat = fs.statSync(full);
			} catch {
				continue;
			}
			if (isClaimed) {
				if (!bestCandidateAnyClaimed || stat.mtimeMs > bestCandidateAnyClaimed.mtime) {
					bestCandidateAnyClaimed = { file: full, mtime: stat.mtimeMs };
				}
			} else {
				if (!bestCandidateAnyUnclaimed || stat.mtimeMs > bestCandidateAnyUnclaimed.mtime) {
					bestCandidateAnyUnclaimed = { file: full, mtime: stat.mtimeMs };
				}
			}
			if (stat.mtimeMs < launchMeta.launchedAt - 120000) continue;
			const delta = Math.abs(stat.mtimeMs - launchMeta.launchedAt);
			if (isClaimed) {
				if (!bestClaimed || delta < bestClaimed.delta) bestClaimed = { file: full, delta };
			} else {
				if (!bestUnclaimed || delta < bestUnclaimed.delta) bestUnclaimed = { file: full, delta };
			}
		}
	}
	if (bestUnclaimed?.file || bestClaimed?.file) return bestUnclaimed?.file ?? bestClaimed?.file ?? null;
	// If no recent file was found, prefer newest file inside cwd-matched candidate dirs.
	if (bestCandidateAnyUnclaimed?.file || bestCandidateAnyClaimed?.file) {
		return bestCandidateAnyUnclaimed?.file ?? bestCandidateAnyClaimed?.file ?? null;
	}

	// Fallback: scan all session files under ~/.gemini/tmp and pick nearest recent.
	const allCandidates = findNewestFiles(root, f => /^session-.*\.json$/.test(path.basename(f)), 800);
	let fallbackUnclaimed: { file: string; delta: number } | null = null;
	let fallbackClaimed: { file: string; delta: number } | null = null;
	for (const file of allCandidates) {
		const isClaimed = claimedFiles.has(file);
		let stat: fs.Stats;
		try {
			stat = fs.statSync(file);
		} catch {
			continue;
		}
		if (stat.mtimeMs < launchMeta.launchedAt - 120000) continue;
		const delta = Math.abs(stat.mtimeMs - launchMeta.launchedAt);
		if (isClaimed) {
			if (!fallbackClaimed || delta < fallbackClaimed.delta) fallbackClaimed = { file, delta };
		} else {
			if (!fallbackUnclaimed || delta < fallbackUnclaimed.delta) fallbackUnclaimed = { file, delta };
		}
	}
	return fallbackUnclaimed?.file ?? fallbackClaimed?.file ?? null;
}

export const PROVIDER_DEFINITIONS: Record<AgentProvider, ProviderDefinition> = {
	claude: {
		id: 'claude',
		label: 'Claude',
		terminalPrefix: 'Claude Code',
		sessionFormat: 'jsonl',
		commandForLaunch: (sessionId?: string) => `claude --session-id ${sessionId || crypto.randomUUID()}`,
		getProjectDirPath: (cwd?: string) => resolveClaudeProjectDir(cwd),
		resolveSessionFile: (cwd, launchMeta) => resolveClaudeSessionFile(cwd, launchMeta),
	},
	codex: {
		id: 'codex',
		label: 'Codex',
		terminalPrefix: 'Codex',
		sessionFormat: 'jsonl',
		commandForLaunch: () => 'codex',
		getProjectDirPath: () => resolveCodexProjectDir(),
		resolveSessionFile: (cwd, launchMeta, claimedFiles) => resolveCodexSessionFile(cwd, launchMeta, claimedFiles),
	},
	gemini: {
		id: 'gemini',
		label: 'Gemini',
		terminalPrefix: 'Gemini',
		sessionFormat: 'gemini-json',
		commandForLaunch: () => 'gemini',
		getProjectDirPath: () => resolveGeminiProjectDir(),
		resolveSessionFile: (cwd, launchMeta, claimedFiles) => resolveGeminiSessionFile(cwd, launchMeta, claimedFiles),
	},
};

export function detectInstalledProviders(): Record<AgentProvider, boolean> {
	return {
		claude: commandExists('claude'),
		codex: commandExists('codex'),
		gemini: commandExists('gemini'),
	};
}

export function getRecommendedProvider(
	installed: Record<AgentProvider, boolean>,
): AgentProvider | null {
	for (const id of ['claude', 'codex', 'gemini'] as AgentProvider[]) {
		if (installed[id]) return id;
	}
	return null;
}

