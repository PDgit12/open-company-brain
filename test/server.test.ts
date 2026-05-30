import { describe, it, expect } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { asyncRoute } from '../src/server/app.js';

/**
 * Resilience contract: a rejected async handler must be forwarded to Express's
 * error middleware (next(err)), never left as an unhandled rejection — which on
 * modern Node crashes the whole server process. Regression guard for the live
 * e2e finding where a recall-provider error took the API down.
 */
describe('asyncRoute (crash prevention)', () => {
  const call = (handler: ReturnType<typeof asyncRoute>): Promise<unknown> =>
    new Promise((resolve) => {
      const next: NextFunction = (err?: unknown) => resolve(err);
      const res = { json: () => resolve('responded') } as unknown as Response;
      handler({} as Request, res, next);
    });

  it('forwards a thrown error to next() instead of crashing', async () => {
    const err = await call(asyncRoute(async () => {
      throw new Error('provider down');
    }));
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('provider down');
  });

  it('does not call next() on success', async () => {
    const outcome = await call(asyncRoute(async (_req, res) => res.json({ ok: true })));
    expect(outcome).toBe('responded');
  });
});
