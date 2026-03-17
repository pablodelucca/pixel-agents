import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { LAYOUT_REVISION_KEY } from '../constants.js';
import { readLayoutFromFile } from '../layoutPersistence.js';
import type {
  IAgentProvider,
  IMessageBridge,
  IPixelAgentsPlugin,
  IRuntimeUI,
} from '../plugin/types.js';
import { VSCodeAgentProvider } from './VSCodeAgentProvider.js';
import { VSCodeMessageBridge } from './VSCodeMessageBridge.js';
import { VSCodeRuntimeUI } from './VSCodeRuntimeUI.js';

export class VSCodePlugin implements IPixelAgentsPlugin, vscode.WebviewViewProvider {
  readonly name = 'vscode';
  readonly version = '1.0.0';

  readonly agentProvider: IAgentProvider;
  readonly messageBridge: IMessageBridge;
  readonly runtimeUI: IRuntimeUI;

  private readonly bridge: VSCodeMessageBridge;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.bridge = new VSCodeMessageBridge();
    this.messageBridge = this.bridge;
    this.agentProvider = new VSCodeAgentProvider();
    this.runtimeUI = new VSCodeRuntimeUI(context);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.bridge.init(webviewView, this.context.extensionUri);
  }

  getAssetsRoot(): string | undefined {
    const bundled = path.join(this.context.extensionUri.fsPath, 'dist', 'assets');
    if (fs.existsSync(bundled)) return path.join(this.context.extensionUri.fsPath, 'dist');
    return undefined;
  }

  /** Dev utility: export current layout as a new versioned default */
  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      void vscode.window.showWarningMessage('Pixel Agents: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      void vscode.window.showErrorMessage('Pixel Agents: No workspace folder found.');
      return;
    }
    const assetsDir = path.join(workspaceRoot, 'webview-ui', 'public', 'assets');

    let maxRevision = 0;
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        const match = /^default-layout-(\d+)\.json$/.exec(file);
        if (match) {
          maxRevision = Math.max(maxRevision, parseInt(match[1], 10));
        }
      }
    }
    const nextRevision = maxRevision + 1;
    layout[LAYOUT_REVISION_KEY] = nextRevision;

    const targetPath = path.join(assetsDir, `default-layout-${nextRevision}.json`);
    fs.writeFileSync(targetPath, JSON.stringify(layout, null, 2), 'utf-8');
    void vscode.window.showInformationMessage(
      `Pixel Agents: Default layout exported as revision ${nextRevision} to ${targetPath}`,
    );
  }

  dispose(): void {
    this.bridge.dispose();
    this.agentProvider.dispose();
  }
}
