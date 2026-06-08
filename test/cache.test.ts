import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  cacheKey,
  InMemoryResponseCache,
  FileResponseCache,
} from '../src/harness/cache.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-cache-'));
const base = { model: 'm', scopes: ['a', 'b'], query: 'q', instruction: 'i' };

describe('cacheKey — stable, input-sensitive hash', () => {
  it('is scope-order independent but changes with any input', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base, scopes: ['b', 'a'] }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, model: 'other' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, query: 'q2' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, instruction: 'i2' }));
  });
});

describe('ResponseCache — TTL + persistence', () => {
  it('returns a fresh hit and a miss for unknown keys (in-memory)', async () => {
    const c = new InMemoryResponseCache(3600);
    expect(await c.get('k')).toBeUndefined();
    await c.set('k', 'answer');
    expect(await c.get('k')).toBe('answer');
  });

  it('expires entries past the TTL', async () => {
    const c = new InMemoryResponseCache(0); // ttl 0 = never fresh / disabled
    await c.set('k', 'answer');
    expect(await c.get('k')).toBeUndefined();
  });

  it('file cache persists a hit across instances and prunes on rewrite', async () => {
    const dir = await tempDir();
    await new FileResponseCache(dir, 3600).set('k', 'v');
    expect(await new FileResponseCache(dir, 3600).get('k')).toBe('v');

    // Setting the same key replaces (not duplicates) the entry.
    await new FileResponseCache(dir, 3600).set('k', 'v2');
    const raw = JSON.parse(
      await (await import('node:fs/promises')).readFile(path.join(dir, 'response-cache.json'), 'utf8'),
    );
    expect(raw.filter((e: { key: string }) => e.key === 'k')).toHaveLength(1);
    expect(await new FileResponseCache(dir, 3600).get('k')).toBe('v2');
  });
});
