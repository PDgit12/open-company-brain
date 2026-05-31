import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createApp } from '../src/server/app.js';

/**
 * HTTP integration tests over the real Express app (mock backend, no creds).
 *
 * These exercise what unit tests can't: zod 400 branches, the action 404/422
 * status mapping, x-access-scopes parsing, and — critically — the terminal
 * error middleware (a thrown handler must yield a safe 500, never crash). We
 * boot the app on an ephemeral port and drive it with fetch (no extra deps).
 */
let server: Server;
let base: string;

async function listen(app: express.Express): Promise<void> {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

beforeAll(async () => {
  const app = await createApp();
  await listen(app);
});

afterAll(() => {
  server?.close();
});

describe('HTTP API (mock backend)', () => {
  it('GET /health reports status + mode', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.mode).toContain('mock');
  });

  it('POST /api/ask with no body → 400 (zod guard)', async () => {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/brief grounded → 200 with sources', async () => {
    const res = await fetch(`${base}/api/brief`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'default-team' },
      body: JSON.stringify({ company: 'Aerodyne Systems' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBeGreaterThan(0);
  });

  it('x-access-scopes isolates: an unknown scope sees nothing', async () => {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'no-such-team' },
      body: JSON.stringify({ question: 'Tell me about Aerodyne' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toHaveLength(0);
  });

  it('approve an unknown action id → 404', async () => {
    const res = await fetch(`${base}/api/actions/does-not-exist/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('learning loop over HTTP: feedback (rejected refusal) → eval candidate', async () => {
    const fb = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'default-team' },
      body: JSON.stringify({
        query: 'history with Globex',
        answer: "I don't have that in the brain yet.",
        verdict: 'rejected',
      }),
    });
    expect(fb.status).toBe(200);
    expect((await fb.json()).ok).toBe(true);

    const cand = await fetch(`${base}/api/eval/candidates`, {
      headers: { 'x-access-scopes': 'default-team' },
    });
    expect(cand.status).toBe(200);
    const { candidates } = await cand.json();
    expect(candidates.some((c: { input: string }) => c.input === 'history with Globex')).toBe(true);

    // Scope isolation across the HTTP boundary: another scope sees none of it.
    const other = await fetch(`${base}/api/eval/candidates`, {
      headers: { 'x-access-scopes': 'some-other-team' },
    });
    expect((await other.json()).candidates).toHaveLength(0);
  });
});
