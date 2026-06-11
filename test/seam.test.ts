import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';

/**
 * End-to-end seam test (mock mode): proves the pieces line up, not just that each
 * works alone. ingest/seed → memory → retrieval → generation, all with the access
 * key agreeing across the seam. This is the test that catches "each unit passes
 * but the wiring is wrong".
 */
describe('brain end-to-end (mock mode)', () => {
  it('produces a grounded, cited answer for a question it has knowledge about', async () => {
    const brain = await Brain.create();
    const result = await brain.ask('Project Atlas migration plan', ['default-team']);

    expect(result.sources.length).toBeGreaterThan(0); // retrieval found records
    expect(result.answer).toContain('Atlas'); // generation used them
    // every source carries provenance (the source system it came from)
    for (const s of result.sources) expect(s.source).toBeTruthy();
  });

  it('refuses for a topic the brain has never heard of', async () => {
    const brain = await Brain.create();
    const result = await brain.ask('What is our history with Foobar Industries?', [
      'default-team',
    ]);
    expect(result.sources).toHaveLength(0);
    expect(result.answer).toContain("don't have that");
  });

  it('answers across multiple sources', async () => {
    const brain = await Brain.create();
    const result = await brain.ask('Northwind subscription renewal roadmap', [
      'default-team',
    ]);
    expect(result.sources.length).toBeGreaterThan(0);
  });
});

// ── Audit fixes: write-boundary scope guard + tool-result clamp ──────────────
import { MockMemoryStore, assertScoped } from '../src/brain/memory.js';
import { clampToolResult } from '../src/harness/agent.js';
import { META_ACCESS, META_SOURCE } from '../src/constants.js';

describe('write boundary — unscoped documents are refused loudly', () => {
  const doc = (access?: string) => ({
    id: 'd1', text: 'x',
    metadata: { [META_SOURCE]: 's', ...(access !== undefined ? { [META_ACCESS]: access } : {}) },
  });

  it('rejects a missing or blank access tag instead of storing invisible knowledge', async () => {
    const store = new MockMemoryStore();
    await expect(store.upsert([doc(undefined)])).rejects.toThrow(/without an access scope/);
    await expect(store.upsert([doc('  ')])).rejects.toThrow(/without an access scope/);
    expect(() => assertScoped([doc('team')])).not.toThrow();
  });
});

describe('tool-result clamp — one huge tool call cannot blow the window', () => {
  it('passes small results through and truncates huge ones with a marker', () => {
    expect(clampToolResult('small')).toBe('small');
    const clamped = clampToolResult('x'.repeat(50_000));
    expect(clamped.length).toBeLessThan(25_000);
    expect(clamped).toContain('truncated');
  });
});
