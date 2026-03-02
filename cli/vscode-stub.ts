/**
 * Minimal vscode stub for CLI builds.
 *
 * The CLI reuses backend modules (fileWatcher, assetLoader, etc.) that import from 'vscode'.
 * Only type-level and a few runtime references exist in the code paths the CLI actually uses.
 * This stub satisfies the require('vscode') calls at bundle time without pulling in the real API.
 */

// The CLI code paths never actually call vscode.window or vscode.workspace functions,
// but the modules that are bundled contain references to them.
export const window = {
	activeTerminal: undefined,
	terminals: [],
	createTerminal: () => ({}),
	showWarningMessage: () => {},
	showInformationMessage: () => {},
	showErrorMessage: () => {},
	showSaveDialog: async () => undefined,
	showOpenDialog: async () => undefined,
	onDidChangeActiveTerminal: () => ({ dispose: () => {} }),
	onDidCloseTerminal: () => ({ dispose: () => {} }),
};

export const workspace = {
	workspaceFolders: undefined,
};

export const env = {
	openExternal: () => {},
};

export class Uri {
	static file(_path: string) { return { fsPath: _path }; }
	static joinPath(base: { fsPath: string }, ...segments: string[]) {
		const path = require('path');
		return { fsPath: path.join(base.fsPath, ...segments) };
	}
}
