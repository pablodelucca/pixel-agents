import * as vscode from 'vscode';

import { COMMAND_EXPORT_DEFAULT_LAYOUT, COMMAND_SHOW_PANEL, VIEW_ID } from './constants.js';
import { AgentLifecycle } from './core/agentLifecycle.js';
import { registerPlugin } from './plugin/registry.js';
import { VSCodePlugin } from './vscode/VSCodePlugin.js';

let lifecycle: AgentLifecycle | undefined;

export function activate(context: vscode.ExtensionContext) {
  const plugin = new VSCodePlugin(context);
  registerPlugin(plugin);

  lifecycle = new AgentLifecycle(plugin);
  lifecycle.start();

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, plugin));

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
      void vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      plugin.exportDefaultLayout();
    }),
  );
}

export function deactivate() {
  lifecycle?.dispose();
  lifecycle = undefined;
}
