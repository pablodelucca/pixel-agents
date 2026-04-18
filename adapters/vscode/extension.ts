import * as vscode from 'vscode';

import {
  COMMAND_EXPORT_DEFAULT_LAYOUT,
  COMMAND_SHOW_PANEL,
  CONFIG_KEY_AUTO_SHOW_PANEL,
  VIEW_ID,
} from './constants.js';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';

let providerInstance: PixelAgentsViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log(`[Pixel Agents] PIXEL_AGENTS_DEBUG=${process.env.PIXEL_AGENTS_DEBUG ?? 'not set'}`);
  const provider = new PixelAgentsViewProvider(context);
  providerInstance = provider;

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      provider.exportDefaultLayout();
    }),
  );

  // Auto-show panel: focus the Pixel Agents panel on startup if the user has
  // opted in via the pixel-agents.autoShowPanel setting.
  const config = vscode.workspace.getConfiguration();
  if (config.get<boolean>(CONFIG_KEY_AUTO_SHOW_PANEL, false)) {
    vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }
}

export function deactivate() {
  providerInstance?.dispose();
}
