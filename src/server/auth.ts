/**
 * Write-path auth + rate limiting for the ingest webhook.
 *
 * The ingest endpoint mutates the shared brain, so when a key is configured it
 * must be presented. Posture:
 *   • INGEST_API_KEY set   → require it (Bearer or x-api-key); grant the caller
 *     INGEST_SCOPES; rate-limit per key. This is the n8n / workflow path.
 *   • INGEST_API_KEY unset → open. Zero-setup local/mock dev stays frictionless.
 *     (A loud one-time warning is logged so an open write path is never silent.)
 *
 * Interactive dashboard reads still use `x-access-scopes`; this only guards the
 * machine write path.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { logger } from '../observability/logger.js';

/** Scopes injected by a successful API-key auth, read by callerScopes(). */
export interface AuthedRequest extends Request {
  ingestScopes?: string[];
}

function presentedKey(req: Request): string | undefined {
  const auth = req.header('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const x = req.header('x-api-key');
  return x?.trim() || undefined;
}

// ── Minimal fixed-window in-memory rate limiter ──────────────────────────────
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > limit;
}

/** Test seam: clear rate-limit state between cases. */
export function resetRateLimiter(): void {
  buckets.clear();
}

let warnedOpen = false;

/**
 * Express middleware guarding the write path. Returns 401 on a missing/wrong key
 * (when a key is configured) and 429 when the per-minute limit is exceeded.
 */
export function ingestAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const { apiKey, scopes, rateLimitPerMin } = config.ingest;

  if (!apiKey) {
    if (!warnedOpen) {
      logger.error('ingest_auth_open', { msg: 'INGEST_API_KEY is not set — the write path is UNAUTHENTICATED. Set it for any shared brain.' });
      warnedOpen = true;
    }
    return next();
  }

  const presented = presentedKey(req);
  if (!presented || presented !== apiKey) {
    res.status(401).json({ error: 'Unauthorized — provide a valid API key (Authorization: Bearer … or x-api-key).' });
    return;
  }

  if (rateLimited(presented, rateLimitPerMin)) {
    res.status(429).json({ error: 'Rate limit exceeded — slow down.' });
    return;
  }

  // Grant the configured scopes to the authenticated (machine) caller.
  if (scopes.length) req.ingestScopes = scopes;
  next();
}
