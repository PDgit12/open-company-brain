import { describe, it, expect } from 'vitest';
import { MockMemoryStore } from '../src/brain/memory.js';
import { MockGenerator, NO_CONTEXT_REPLY } from '../src/agents/generator.js';
import { demoDocuments } from '../src/seed/seed-data.js';

const ALLOWED = ['default-team'];

describe('recall layer (access + retrieval)', () => {
  it('only returns chunks the caller is allowed to see', async () => {
    const store = new MockMemoryStore();
    await store.upsert(demoDocuments());

    const allowed = await store.retrieve({ query: 'Project Atlas migration', accessScopes: ALLOWED });
    expect(allowed.length).toBeGreaterThan(0);

    const denied = await store.retrieve({ query: 'Project Atlas migration', accessScopes: ['some-other-team'] });
    expect(denied).toHaveLength(0); // access filter holds even with a matching query
  });
});

describe('trust contract', () => {
  it('refuses (does not invent) when retrieval is empty', async () => {
    const gen = new MockGenerator();
    const answer = await gen.generate({ prompt: 'Answer: anything', chunks: [] });
    expect(answer).toBe(NO_CONTEXT_REPLY);
  });

  it('grounds the answer in retrieved chunks when present', async () => {
    const gen = new MockGenerator();
    const chunks = [
      { text: 'Project Atlas kickoff: migrating the billing service.', source: 'project-notes', metadata: {}, score: 1 },
    ];
    const answer = await gen.generate({ prompt: 'Answer: Project Atlas', chunks });
    expect(answer).toContain('Project Atlas');
    expect(answer).not.toBe(NO_CONTEXT_REPLY);
  });
});
