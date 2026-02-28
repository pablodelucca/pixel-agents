import * as vscode from 'vscode';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';
import { VIEW_ID, COMMAND_SHOW_PANEL, COMMAND_EXPORT_DEFAULT_LAYOUT, COMMAND_CONNECT_TERMINAL } from './constants.js';

let providerInstance: PixelAgentsViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	const provider = new PixelAgentsViewProvider(context);
	providerInstance = provider;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
			vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
			provider.exportDefaultLayout();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_CONNECT_TERMINAL, (terminal: vscode.Terminal) => {
			provider.connectTerminal(terminal);
		})
	);
}

export function deactivate() {
	providerInstance?.dispose();
}
