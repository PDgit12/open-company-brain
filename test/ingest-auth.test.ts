import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import type express from 'express';

/**
 * The write-path auth is config-driven, and config is parsed once at import. To
 * exercise the INGEST_API_KEY=set branch we reset the module graph, set the env,
 * and import a FRESH app whose config sees the key — without disturbing the
 * keyless default the rest of the suite relies on.
 */
let server: Server;
let base: string;
const KEY = 'test-secret-key';

beforeAll(async () => {
  vi.resetModules();
  process.env.INGEST_API_KEY = KEY;
  process.env.INGEST_SCOPES = 'workflow-team';
  const { createApp } = await import('../src/server/app.js');
  const app = (await createApp()) as express.Express;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
  process.env.INGEST_API_KEY = '';
  process.env.INGEST_SCOPES = '';
  vi.resetModules();
});

const body = JSON.stringify({ format: 'text', source: 'wf', content: 'Pipeline run completed at 12:01.' });

describe('ingest write-path auth (INGEST_API_KEY set)', () => {
  it('rejects a request with no key → 401', async () => {
    const res = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong key → 401', async () => {
    const res = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'nope' },
      body,
    });
    expect(res.status).toBe(401);
  });

  it('accepts a valid Bearer key and scopes the data to INGEST_SCOPES', async () => {
    const res = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.scope).toBe('workflow-team'); // granted by the key, not the client

    // The ingested data is visible under the granted scope.
    const stats = await fetch(`${base}/api/stats`, { headers: { 'x-access-scopes': 'workflow-team' } });
    const { total } = await stats.json();
    expect(total).toBeGreaterThan(0);
  });

  it('also accepts the x-api-key header', async () => {
    const res = await fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body,
    });
    expect(res.status).toBe(200);
  });
});
