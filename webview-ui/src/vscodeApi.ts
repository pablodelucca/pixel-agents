import type { WebviewToExtensionMessage } from './messages.js'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

const vsCodeApi = acquireVsCodeApi()

export const vscode = {
  postMessage(message: WebviewToExtensionMessage): void {
    vsCodeApi.postMessage(message)
  },
}
