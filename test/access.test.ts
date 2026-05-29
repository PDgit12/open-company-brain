import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';

/**
 * Multi-scope access control: the leadership-only engagement (seed id 6) must be
 * invisible to a default-team caller and visible to a leadership caller.
 */
describe('multi-scope access control', () => {
  const query = 'confidential mandate sensitive figures NorthBridge';

  it('hides leadership-only records from a default-team caller', async () => {
    const brain = await Brain.create();
    const r = await brain.ask(query, ['default-team']);
    const leaked = r.sources.some((s) => s.text.toLowerCase().includes('confidential'));
    expect(leaked).toBe(false);
  });

  it('reveals leadership-only records to a leadership caller', async () => {
    const brain = await Brain.create();
    const r = await brain.ask(query, ['default-team', 'leadership']);
    const seen = r.sources.some((s) => s.text.toLowerCase().includes('confidential'));
    expect(seen).toBe(true);
  });
});

describe('relationship-health agent', () => {
  it('surfaces records with open actions / attention items, scoped', async () => {
    const brain = await Brain.create();
    const r = await brain.health(['default-team']);
    expect(r.sources.length).toBeGreaterThan(0);
    // must not include the leadership-only record for a default-team caller
    expect(r.sources.some((s) => s.text.toLowerCase().includes('confidential'))).toBe(false);
  });
});
