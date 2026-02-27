import * as fs from 'fs';
import * as path from 'path';
import type { AgentState } from '../types.js';
import { CODEX_FIRST_LINE_READ_CHUNK_BYTES, CODEX_FIRST_LINE_READ_MAX_BYTES } from '../constants.js';
import { listJsonlFilesRecursive } from '../sessionFiles.js';

export function listCodexJsonlFiles(projectDir: string): string[] {
	return listJsonlFilesRecursive(projectDir);
}

export function matchesWorkspaceCodexSession(filePath: string, workspaceRoot: string | undefined): boolean {
	if (!workspaceRoot) return true;
	const cwd = readCodexSessionCwd(filePath);
	if (!cwd) return false;
	return path.resolve(cwd) === path.resolve(workspaceRoot);
}

export function findPendingCodexAgent(
	agents: Map<number, AgentState>,
): AgentState | undefined {
	return [...agents.values()]
		.filter((agent) => agent.runtime === 'codex' && !agent.jsonlFile)
		.sort((a, b) => b.id - a.id)[0];
}

export function findNewestUnassignedMatchingCodexFile(
	files: string[],
	agents: Map<number, AgentState>,
	workspaceRoot: string | undefined,
): string | undefined {
	const assignedFiles = new Set<string>();
	for (const agent of agents.values()) {
		if (agent.jsonlFile) {
			assignedFiles.add(agent.jsonlFile);
		}
	}

	let newestFile = '';
	let newestMtime = -1;
	for (const file of files) {
		if (assignedFiles.has(file)) continue;
		if (!matchesWorkspaceCodexSession(file, workspaceRoot)) continue;
		try {
			const stat = fs.statSync(file);
			if (stat.mtimeMs > newestMtime) {
				newestMtime = stat.mtimeMs;
				newestFile = file;
			}
		} catch {
			// Ignore stat failures for transient files.
		}
	}
	return newestFile || undefined;
}

function readCodexSessionCwd(filePath: string): string | null {
	let fd: number | undefined;
	try {
		fd = fs.openSync(filePath, 'r');
		let readOffset = 0;
		let firstLine = '';
		while (readOffset < CODEX_FIRST_LINE_READ_MAX_BYTES && !firstLine.includes('\n')) {
			const chunk = Buffer.alloc(CODEX_FIRST_LINE_READ_CHUNK_BYTES);
			const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, readOffset);
			if (bytesRead <= 0) break;
			firstLine += chunk.toString('utf-8', 0, bytesRead);
			readOffset += bytesRead;
		}
		const line = firstLine.split('\n')[0];
		if (!line.trim()) return null;
		const record = JSON.parse(line) as { type?: string; payload?: { cwd?: unknown } };
		if (record.type !== 'session_meta') return null;
		const cwd = record.payload?.cwd;
		return typeof cwd === 'string' ? cwd : null;
	} catch {
		return null;
	} finally {
		if (fd !== undefined) {
			try {
				fs.closeSync(fd);
			} catch {
				// Ignore close errors.
			}
		}
	}
}
