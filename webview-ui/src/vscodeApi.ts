import { isBrowserRuntime, isElectronRuntime } from './runtime';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

function getApi(): { postMessage(msg: unknown): void } {
  if (isElectronRuntime && window.pixelAgentsHost) {
    return {
      postMessage: (msg: unknown) => {
        void window.pixelAgentsHost?.postMessage(msg);
      },
    };
  }

  if (isBrowserRuntime) {
    return { postMessage: (msg: unknown) => console.log('[vscode.postMessage]', msg) };
  }

  return acquireVsCodeApi() as { postMessage(msg: unknown): void };
}

export const vscode: { postMessage(msg: unknown): void } = getApi();
