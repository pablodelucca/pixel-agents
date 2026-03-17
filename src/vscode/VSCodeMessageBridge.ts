import * as fs from 'fs';
import * as vscode from 'vscode';

import type { IDisposable, IMessageBridge } from '../plugin/types.js';

export class VSCodeMessageBridge implements IMessageBridge {
  private webview: vscode.Webview | undefined;
  private messageHandlers: ((msg: Record<string, unknown>) => void)[] = [];
  private readyHandlers: (() => void)[] = [];

  init(webviewView: vscode.WebviewView, extensionUri: vscode.Uri): void {
    this.webview = webviewView.webview;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, extensionUri);

    webviewView.webview.onDidReceiveMessage((message: Record<string, unknown>) => {
      if (message.type === 'webviewReady') {
        for (const handler of this.readyHandlers) {
          handler();
        }
      }
      for (const handler of this.messageHandlers) {
        handler(message);
      }
    });
  }

  postMessage(message: Record<string, unknown>): void {
    this.webview?.postMessage(message);
  }

  onMessage(handler: (message: Record<string, unknown>) => void): IDisposable {
    this.messageHandlers.push(handler);
    return {
      dispose: () => {
        this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
      },
    };
  }

  onReady(handler: () => void): IDisposable {
    this.readyHandlers.push(handler);
    return {
      dispose: () => {
        this.readyHandlers = this.readyHandlers.filter((h) => h !== handler);
      },
    };
  }

  dispose(): void {
    this.messageHandlers = [];
    this.readyHandlers = [];
    this.webview = undefined;
  }
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html = fs.readFileSync(indexPath, 'utf-8');

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath as string);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
