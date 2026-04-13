// ── User ─────────────────────────────────────────────────────
export const PRIVY_PREFIX = 'did:privy:';

/** Strip 'did:privy:' prefix from Privy user IDs */
export function normalizeUserId(userId: string): string {
  if (userId.startsWith(PRIVY_PREFIX)) {
    return userId.slice(PRIVY_PREFIX.length);
  }
  return userId;
}

/** Extract user ID from Express request (header or query param) */
export function getUserIdFromRequest(req: {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}): string | null {
  const userIdHeader = req.headers['x-user-id'];
  if (typeof userIdHeader === 'string' && userIdHeader) {
    return normalizeUserId(userIdHeader);
  }

  const userIdQuery = req.query.userId;
  if (typeof userIdQuery === 'string' && userIdQuery) {
    return normalizeUserId(userIdQuery);
  }

  return null;
}
