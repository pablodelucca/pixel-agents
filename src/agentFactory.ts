import type * as vscode from 'vscode';
import type { AgentState } from './types.js';

export function createAgentState(
	id: number,
	terminal: vscode.Terminal,
	projectDir: string,
	jsonlFile: string,
	options?: { fileOffset?: number; folderName?: string },
): AgentState {
	return {
		id,
		terminalRef: terminal,
		projectDir,
		jsonlFile,
		fileOffset: options?.fileOffset ?? 0,
		lineBuffer: '',
		activeToolIds: new Set(),
		activeToolStatuses: new Map(),
		activeToolNames: new Map(),
		activeSubagentToolIds: new Map(),
		activeSubagentToolNames: new Map(),
		isWaiting: false,
		permissionSent: false,
		hadToolsInTurn: false,
		folderName: options?.folderName,
	};
}
