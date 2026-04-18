import type * as vscode from 'vscode';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { PersistedAgent } from '../../core/src/schemas.js';
import {
  WORKSPACE_KEY_AGENT_SEATS,
  WORKSPACE_KEY_AGENTS,
  WORKSPACE_KEY_LAYOUT,
} from './constants.js';

/**
 * VS Code implementation of StateAdapter. Wraps workspaceState (per-workspace)
 * and globalState (user-level) with zero format changes -- the same JSON shapes
 * are stored so existing users' state restores correctly after the upgrade.
 */
export class VscodeStateAdapter implements StateAdapter {
  constructor(private context: vscode.ExtensionContext) {}

  // ── Per-workspace (agents + seats) ──────────────────────────────────

  loadAgents(): PersistedAgent[] {
    return this.context.workspaceState.get<PersistedAgent[]>(WORKSPACE_KEY_AGENTS, []);
  }

  saveAgents(agents: PersistedAgent[]): void {
    this.context.workspaceState.update(WORKSPACE_KEY_AGENTS, agents);
  }

  loadSeats(): Record<string, { palette?: number; hueShift?: number; seatId?: string }> {
    return this.context.workspaceState.get<
      Record<string, { palette?: number; hueShift?: number; seatId?: string }>
    >(WORKSPACE_KEY_AGENT_SEATS, {});
  }

  saveSeats(seats: Record<string, { palette?: number; hueShift?: number; seatId?: string }>): void {
    this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, seats);
  }

  // ── User-level settings (shared across workspaces) ─────────────────

  getSetting<T>(key: string, defaultValue: T): T {
    return this.context.globalState.get<T>(key, defaultValue);
  }

  setSetting<T>(key: string, value: T): void {
    this.context.globalState.update(key, value);
  }

  // ── One-time migration ─────────────────────────────────────────────

  loadLegacyLayout(): Record<string, unknown> | undefined {
    return this.context.workspaceState.get<Record<string, unknown>>(WORKSPACE_KEY_LAYOUT);
  }

  clearLegacyLayout(): void {
    this.context.workspaceState.update(WORKSPACE_KEY_LAYOUT, undefined);
  }
}
