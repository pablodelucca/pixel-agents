// Stub for standalone browser mode (no VS Code extension)
export const vscode = {
  postMessage(msg: unknown): void {
    // No-op in standalone mode — messages that would go to the extension are silently dropped
    void msg
  },
}
