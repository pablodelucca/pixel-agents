/**
 * Formal audit logging module for security-relevant events (server-side).
 *
 * Addresses SEC-008: No Formal Audit Logging for Security-Relevant Events
 *
 * Standalone version of src/auditLogger.ts that uses the server's own logger
 * (no VS Code dependencies).
 *
 * SOC 2 controls: CC7.2 (System Monitoring), CC7.3 (Evaluation of Findings)
 */
import { logger } from './logger.js';

/** Actors that can generate security-relevant events. */
export type AuditActor = 'user' | 'system';

/** Outcome of the audited action. */
export type AuditOutcome = 'success' | 'failure';

/** Structured audit event record. */
export interface AuditEvent {
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
  /** Machine-readable event identifier (snake_case). */
  event: string;
  /** Who initiated the action. */
  actor: AuditActor;
  /** The resource or subsystem affected. */
  resource: string;
  /** Whether the action succeeded or failed. */
  outcome: AuditOutcome;
  /** Optional additional context (must not include secrets or full paths). */
  details?: Record<string, unknown>;
}

/**
 * Emit a structured audit log entry.
 *
 * The entry is written at WARN level with an `[AUDIT]` prefix so it is always
 * captured in production logs and can be distinguished from operational messages.
 */
export function auditLog(event: AuditEvent): void {
  logger.warn(`[AUDIT] ${JSON.stringify(event)}`);
}
