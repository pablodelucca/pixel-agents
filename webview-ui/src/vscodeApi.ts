declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

export const vscode: { postMessage(msg: unknown): void } =
  typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : { postMessage() {} };
