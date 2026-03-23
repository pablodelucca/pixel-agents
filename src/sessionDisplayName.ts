import * as path from 'path';

const THREAD_ID_PATTERN = /^[0-9a-f]{8,}(?:-[0-9a-f]{2,})+$/i;

export function getReadableThreadName(threadName?: string): string | undefined {
  const trimmed = threadName?.trim();
  if (!trimmed || THREAD_ID_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function getSessionDisplayName(
  workspacePaths: string[],
  sessionCwd?: string,
  threadName?: string,
): string | undefined {
  const readableThreadName = getReadableThreadName(threadName);
  if (readableThreadName) {
    return readableThreadName;
  }

  if (workspacePaths.length > 1 && sessionCwd) {
    return path.basename(sessionCwd);
  }

  return undefined;
}
