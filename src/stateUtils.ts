import * as vscode from 'vscode';

/**
 * Safely updates a VS Code state (workspaceState or globalState).
 * Catches and logs any unhandled promise rejections (e.g., when no workspace is opened).
 */
export async function safeUpdateState(
  state: vscode.Memento,
  key: string,
  value: any,
): Promise<void> {
  try {
    await state.update(key, value);
  } catch (error) {
    console.warn(`[Pixel Agents] Failed to update state for key "${key}":`, error);
  }
}
