declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

export const vscode: { postMessage(msg: unknown): void } =
  typeof acquireVsCodeApi !== 'undefined'
    ? acquireVsCodeApi()
    : {
        postMessage(msg: unknown) {
          if (import.meta.env.DEV) {
            console.debug('[vscodeApi stub] postMessage:', msg);
          }
        },
      };
