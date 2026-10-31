/**
 * OMNIRA — Security helpers: rate limiting, client IP / user agent
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

/**
 * Fixed-window in-memory rate limiter. Throws when the limit is exceeded.
 * (Single-instance deployments; swap for Redis when scaling out.)
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw new Error('RATE_LIMITED');
  }
  bucket.count += 1;
}

/** Best-effort client IP (proxy-aware). */
export function getClientIp(req: unknown): string | null {
  const r = req as { headers?: Record<string, string | string[]>; socket?: { remoteAddress?: string } };
  const h = r?.headers ?? {};
  const forwarded = h['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0]!;
  return r?.socket?.remoteAddress ?? null;
}

/** Best-effort user agent. */
export function getUserAgent(req: unknown): string | null {
  const h = (req as { headers?: Record<string, string> })?.headers ?? {};
  return h['user-agent'] ?? null;
}
