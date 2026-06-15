import { describe, it, expect, beforeEach, vi } from 'vitest';
import { META_ACCESS, META_SOURCE } from '../src/constants.js';
import type { MemoryDocument } from '../src/brain/documents.js';

// Mock the AWS SDK so the store's LOGIC (doc->vector mapping, scope filter,
// distance->score) is tested with zero AWS. The live integration still needs
// real creds; this guards everything up to the wire.
const h = vi.hoisted(() => ({
  sent: [] as { __t: string; input: Record<string, unknown> }[],
  queryResp: { vectors: [] as unknown[] },
  listResp: { vectors: [] as unknown[], nextToken: undefined as string | undefined },
}));

vi.mock('@aws-sdk/client-s3vectors', () => ({
  S3VectorsClient: class {
    async send(cmd: { __t: string; input: Record<string, unknown> }) {
      h.sent.push(cmd);
      if (cmd.__t === 'query') return h.queryResp;
      if (cmd.__t === 'list') return h.listResp;
      return {};
    }
  },
  PutVectorsCommand: class {
    __t = 'put';
    constructor(public input: Record<string, unknown>) {}
  },
  QueryVectorsCommand: class {
    __t = 'query';
    constructor(public input: Record<string, unknown>) {}
  },
  ListVectorsCommand: class {
    __t = 'list';
    constructor(public input: Record<string, unknown>) {}
  },
}));

const doc = (id: string, text: string, access: string, source = 's'): MemoryDocument => ({
  id,
  text,
  metadata: { [META_ACCESS]: access, [META_SOURCE]: source },
});

describe('S3VectorsMemoryStore (BYO Amazon S3 Vectors) — logic, mocked SDK', () => {
  beforeEach(() => {
    h.sent.length = 0;
    h.queryResp = { vectors: [] };
    h.listResp = { vectors: [], nextToken: undefined };
  });

  it('upsert maps docs to {key, data.float32, metadata+__text} and targets the BYO bucket/index', async () => {
    const { S3VectorsMemoryStore } = await import('../src/brain/memory.js');
    const store = new S3VectorsMemoryStore('cust-bucket', 'brain-index', 'us-west-2');
    const n = await store.upsert([doc('a:1', 'refund policy text', 'team', 'policy')]);
    expect(n).toBe(1);
    const put = h.sent.find((c) => c.__t === 'put')!;
    expect(put.input.vectorBucketName).toBe('cust-bucket');
    expect(put.input.indexName).toBe('brain-index');
    const v = (put.input.vectors as { key: string; data: { float32: number[] }; metadata: Record<string, string> }[])[0];
    expect(v.key).toBe('a:1');
    expect(Array.isArray(v.data.float32)).toBe(true);
    expect(v.metadata.__text).toBe('refund policy text'); // text stashed for retrieval
    expect(v.metadata[META_ACCESS]).toBe('team');
  });

  it('upsert refuses an unscoped doc (the write-boundary seam holds on S3 too)', async () => {
    const { S3VectorsMemoryStore } = await import('../src/brain/memory.js');
    const store = new S3VectorsMemoryStore('b', 'i', 'us-east-1');
    await expect(store.upsert([{ id: 'x', text: 't', metadata: {} }])).rejects.toThrow(/scope/i);
  });

  it('retrieve returns __text, source, distance->score, and drops out-of-scope hits', async () => {
    const { S3VectorsMemoryStore } = await import('../src/brain/memory.js');
    h.queryResp = {
      vectors: [
        { key: 'a', distance: 0.1, metadata: { __text: 'in scope', [META_ACCESS]: 'team', [META_SOURCE]: 'policy' } },
        { key: 'b', distance: 0.2, metadata: { __text: 'leak', [META_ACCESS]: 'secret', [META_SOURCE]: 'x' } },
      ],
    };
    const store = new S3VectorsMemoryStore('b', 'i', 'us-east-1');
    const hits = await store.retrieve({ query: 'q', accessScopes: ['team'], topK: 5 });
    expect(hits).toHaveLength(1); // the 'secret' hit is filtered out
    expect(hits[0]).toMatchObject({ text: 'in scope', source: 'policy' });
    expect(hits[0]!.score).toBeCloseTo(0.9); // 1 - distance(0.1)
    const q = h.sent.find((c) => c.__t === 'query')!;
    expect(q.input.returnMetadata).toBe(true);
    expect(q.input.returnDistance).toBe(true);
  });

  it('stats counts per source within scope', async () => {
    const { S3VectorsMemoryStore } = await import('../src/brain/memory.js');
    h.listResp = {
      vectors: [
        { metadata: { [META_ACCESS]: 'team', [META_SOURCE]: 'policy' } },
        { metadata: { [META_ACCESS]: 'team', [META_SOURCE]: 'policy' } },
        { metadata: { [META_ACCESS]: 'team', [META_SOURCE]: 'faq' } },
        { metadata: { [META_ACCESS]: 'secret', [META_SOURCE]: 'hidden' } },
      ],
      nextToken: undefined,
    };
    const store = new S3VectorsMemoryStore('b', 'i', 'us-east-1');
    const stats = await store.stats(['team']);
    expect(stats).toEqual([
      { source: 'policy', count: 2 },
      { source: 'faq', count: 1 },
    ]);
  });
});
