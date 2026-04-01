/**
 * Shared session ID to numeric ID mapping
 *
 * Used by both useRemoteMessages and RemoteApp to ensure consistent ID mapping
 */

const sessionIdToNumeric = new Map<string, number>();
let nextNumericId = 1;

export function getNumericId(sessionId: string): number {
  if (!sessionIdToNumeric.has(sessionId)) {
    sessionIdToNumeric.set(sessionId, nextNumericId++);
  }
  return sessionIdToNumeric.get(sessionId)!;
}

export function getSessionId(numericId: number): string | undefined {
  const entry = Array.from(sessionIdToNumeric.entries()).find(([_, n]) => n === numericId);
  return entry?.[0];
}

export function deleteSessionMapping(sessionId: string): void {
  sessionIdToNumeric.delete(sessionId);
}

export function getAllSessionMappings(): Map<string, number> {
  return sessionIdToNumeric;
}