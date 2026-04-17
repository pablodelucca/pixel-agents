/**
 * Pluggable persistence backend for agent state and user settings.
 *
 * VS Code uses workspaceState/globalState. A future standalone server
 * would use file-based JSON. JetBrains would use its own API.
 *
 * Layout persistence (~/.pixel-agents/layout.json) is NOT part of this
 * interface -- it's already VS Code-free (plain fs I/O in layoutPersistence.ts).
 */

import type { PersistedAgent } from './schemas.js';

export interface StateAdapter {
  // ── Per-workspace (agents + seats) ──────────────────────────────────

  loadAgents(): PersistedAgent[];
  saveAgents(agents: PersistedAgent[]): void;

  loadSeats(): Record<string, { palette?: number; hueShift?: number; seatId?: string }>;
  saveSeats(seats: Record<string, { palette?: number; hueShift?: number; seatId?: string }>): void;

  // ── User-level settings (shared across workspaces) ─────────────────

  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;

  // ── One-time migration (reads old workspaceState layout, clears it) ─

  loadLegacyLayout(): Record<string, unknown> | undefined;
  clearLegacyLayout(): void;
}
