/**
 * Resilient JSON POST for model calls.
 *
 * Raw `fetch` to a model server has no timeout and no retry: a hung Ollama, a
 * transient 503, or a rate-limit 429 surfaces as a stuck or failed run. This
 * wraps the model-call sites (Ollama chat + embeddings) with an AbortController
 * timeout and exponential backoff + jitter on retryable failures (network
 * errors, 429, and 5xx). 4xx (other than 429) are NOT retried — they're caller
 * errors that a retry won't fix.
 */

import { config } from '../config.js';

export interface PostJsonOptions {
  timeoutMs?: number;
  retries?: number;
  /** Human label for error messages, e.g. 'Ollama chat'. */
  label?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Backoff with jitter: ~250ms, 500ms, 1s… plus up to 100ms of jitter. */
function backoffMs(attempt: number): number {
  return 250 * 2 ** attempt + Math.floor(Math.random() * 100);
}

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

export async function postJson<T>(
  url: string,
  body: unknown,
  opts: PostJsonOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? config.comb.httpTimeoutMs;
  const retries = opts.retries ?? config.comb.httpRetries;
  const label = opts.label ?? 'HTTP';
  let lastErr: Error = new Error(`${label}: request failed`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    // Network/abort failures are retryable and caught here. HTTP-status failures
    // are decided AFTER, outside this try, so a non-retryable 4xx is never
    // swallowed back into a retry.
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      lastErr = controller.signal.aborted
        ? new Error(`${label} timed out after ${timeoutMs}ms`)
        : err instanceof Error
          ? err
          : new Error(String(err));
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`${label} failed (${res.status}): ${text}`);
      if (isRetryableStatus(res.status) && attempt < retries) {
        lastErr = err;
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err; // non-retryable (e.g. 4xx) or budget exhausted
    }
    return (await res.json()) as T;
  }
  throw lastErr;
}
