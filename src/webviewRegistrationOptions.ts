import * as vscode from 'vscode';

type WebviewProviderOptions = NonNullable<
  Parameters<typeof vscode.window.registerWebviewViewProvider>[2]
>;

export const PIXEL_AGENTS_WEBVIEW_OPTIONS: WebviewProviderOptions = {
  webviewOptions: {
    retainContextWhenHidden: true,
  },
};
