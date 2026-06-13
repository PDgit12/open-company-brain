import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileKeywordMemoryStore } from '../src/brain/memory.js';
import { META_ACCESS, META_SOURCE } from '../src/constants.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-kw-'));
const doc = (id: string, text: string, scope = 'team', source = 'docs') =>
  ({ id, text, metadata: { [META_ACCESS]: scope, [META_SOURCE]: source } });

describe('FileKeywordMemoryStore — model-free persistent recall', () => {
  it('retrieves by term overlap, scope-filtered, best first — across a restart', async () => {
    const dir = await tempDir();
    await new FileKeywordMemoryStore(dir).upsert([
      doc('1', 'Refunds over $10,000 require Finance Director approval'),
      doc('2', 'Parental leave is 16 weeks for the primary caregiver'),
      doc('3', 'secret leadership compensation figures', 'leadership'),
    ]);
    // New instance (another process) — persisted, no embeddings, no model.
    const s = new FileKeywordMemoryStore(dir);
    const hits = await s.retrieve({ query: 'refund approval threshold', accessScopes: ['team'] });
    expect(hits[0]?.text).toContain('Refunds over');
    // scope isolation: a team caller never sees the leadership doc
    const leak = await s.retrieve({ query: 'compensation figures', accessScopes: ['team'] });
    expect(leak).toEqual([]);
  });

  it('rejects unscoped writes (same boundary as every store)', async () => {
    const s = new FileKeywordMemoryStore(await tempDir());
    await expect(s.upsert([{ id: 'x', text: 'y', metadata: {} }])).rejects.toThrow(/access scope/);
  });
});
