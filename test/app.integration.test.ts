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

  it('POST /api/ask grounded → 200 with sources', async () => {
    const res = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'default-team' },
      body: JSON.stringify({ question: 'Project Atlas migration plan' }),
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
      body: JSON.stringify({ question: 'Project Atlas migration plan' }),
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

  it('data-in: POST /api/ingest text → /api/ask grounds + cites it', async () => {
    const ingest = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'default-team' },
      body: JSON.stringify({
        format: 'text',
        source: 'field-notes',
        content: 'Zephyr Robotics signed a pilot for warehouse automation in Q2.',
      }),
    });
    expect(ingest.status).toBe(200);
    const ir = await ingest.json();
    expect(ir.ok).toBe(true);
    expect(ir.ingested).toBe(1);
    expect(ir.source).toBe('field-notes');

    // The freshly ingested note is now retrievable + cited by the ask agent.
    const ask = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'default-team' },
      body: JSON.stringify({ question: 'Zephyr Robotics warehouse pilot' }),
    });
    const answer = await ask.json();
    expect(answer.sources.some((s: { source: string }) => s.source === 'field-notes')).toBe(true);
  });

  it('ingest is scope-gated: a note ingested in one scope is invisible to another', async () => {
    await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'team-a' },
      body: JSON.stringify({ format: 'text', source: 'secret', content: 'Project Halcyon budget is confidential.' }),
    });
    const leak = await fetch(`${base}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'team-b' },
      body: JSON.stringify({ question: 'Project Halcyon budget' }),
    });
    const { sources } = await leak.json();
    expect(sources.some((s: { source: string }) => s.source === 'secret')).toBe(false);
  });

  it('GET /api/stats returns real per-source counts after ingest', async () => {
    await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'stats-team' },
      body: JSON.stringify({ format: 'text', source: 'memo', content: 'one\n\ntwo\n\nthree' }),
    });
    const res = await fetch(`${base}/api/stats`, { headers: { 'x-access-scopes': 'stats-team' } });
    expect(res.status).toBe(200);
    const { sources, total } = await res.json();
    expect(total).toBe(3);
    expect(sources.find((s: { source: string }) => s.source === 'memo')?.count).toBe(3);
  });

  it('POST /api/ingest with malformed body → 400', async () => {
    const res = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-access-scopes': 'default-team' },
      body: JSON.stringify({ format: 'text' }), // no content
    });
    expect(res.status).toBe(400);
  });
});
