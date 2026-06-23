import { describe, it, expect } from 'vitest';
import { MockMemoryStore } from '../src/brain/memory.js';
import type { MemoryDocument } from '../src/brain/documents.js';

const doc = (id: string, source: string, access: string): MemoryDocument => ({
  id,
  text: id,
  metadata: { source, access },
});

/**
 * `removeSource` powers `comb ingest --replace`: re-ingesting an updated URL/feed
 * must drop the previous snapshot of that source, not pile a stale copy beside it,
 * and must leave other sources untouched. Unit-tested on the store (isolated).
 */
describe('removeSource (clean per-source refresh)', () => {
  it('removes only the named source within the given scope', async () => {
    const store = new MockMemoryStore();
    await store.upsert([doc('feed:1', 'feed', 'team'), doc('feed:2', 'feed', 'team'), doc('keep:1', 'keep', 'team')]);

    const removed = await store.removeSource('feed', ['team']);
    expect(removed).toBe(2);

    const left = await store.all(['team']);
    expect(left.map((d) => d.id)).toEqual(['keep:1']); // other source survives
  });

  it('does not cross scope boundaries', async () => {
    const store = new MockMemoryStore();
    await store.upsert([doc('feed:1', 'feed', 'team-a'), doc('feed:2', 'feed', 'team-b')]);

    await store.removeSource('feed', ['team-a']);
    expect((await store.all(['team-a'])).length).toBe(0);
    expect((await store.all(['team-b'])).length).toBe(1); // other scope's copy kept
  });
});
