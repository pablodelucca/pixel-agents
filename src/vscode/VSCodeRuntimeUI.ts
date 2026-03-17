import * as vscode from 'vscode';

import type {
  Event,
  IDisposable,
  IRuntimeUI,
  OpenDialogOptions,
  SaveDialogOptions,
  WorkspaceFolder,
} from '../plugin/types.js';

export class VSCodeRuntimeUI implements IRuntimeUI {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async showOpenDialog(options?: OpenDialogOptions): Promise<string[] | null> {
    const uris = await vscode.window.showOpenDialog({
      filters: options?.filters,
      canSelectMany: options?.canSelectMany ?? false,
    });
    if (!uris || uris.length === 0) return null;
    return uris.map((u) => u.fsPath);
  }

  async showSaveDialog(options?: SaveDialogOptions): Promise<string | null> {
    const uri = await vscode.window.showSaveDialog({
      filters: options?.filters,
      defaultUri: options?.defaultPath ? vscode.Uri.file(options.defaultPath) : undefined,
    });
    return uri?.fsPath ?? null;
  }

  async showInformationMessage(message: string): Promise<void> {
    await vscode.window.showInformationMessage(message);
  }

  async showErrorMessage(message: string): Promise<void> {
    await vscode.window.showErrorMessage(message);
  }

  async openPath(fsPath: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.file(fsPath));
  }

  getWorkspaceFolders(): WorkspaceFolder[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      name: f.name,
      path: f.uri.fsPath,
    }));
  }

  onWorkspaceFoldersChanged: Event<WorkspaceFolder[]> = (handler): IDisposable => {
    const disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      handler(this.getWorkspaceFolders());
    });
    return { dispose: () => disposable.dispose() };
  };

  getState<T>(key: string): T | undefined {
    return this.context.workspaceState.get<T>(key);
  }

  async setState<T>(key: string, value: T): Promise<void> {
    await this.context.workspaceState.update(key, value);
  }

  getGlobalState<T>(key: string): T | undefined {
    return this.context.globalState.get<T>(key);
  }

  async setGlobalState<T>(key: string, value: T): Promise<void> {
    await this.context.globalState.update(key, value);
  }
}
