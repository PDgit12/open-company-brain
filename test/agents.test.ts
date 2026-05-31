import { describe, it, expect } from 'vitest';
import { InMemoryCustomAgentStore } from '../src/agents/registry.js';

/** No-code custom agents: a definition is just name + instruction + retrieval query. */
describe('custom agent registry', () => {
  it('saves an agent and defaults the query to the name', async () => {
    const store = new InMemoryCustomAgentStore();
    const a = await store.save({ name: 'Risk scan', instruction: 'Flag relationship risks.' });
    expect(a.id).toBeTruthy();
    expect(a.name).toBe('Risk scan');
    expect(a.query).toBe('Risk scan'); // falls back to name when no query given
    expect(a.createdAt).toBeTruthy();
  });

  it('keeps an explicit retrieval query and lists saved agents', async () => {
    const store = new InMemoryCustomAgentStore();
    await store.save({ name: 'Renewals', instruction: 'List upcoming renewals.', query: 'renewal date tier' });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.query).toBe('renewal date tier');
    expect(await store.get(all[0]!.id)).toMatchObject({ name: 'Renewals' });
  });

  it('trims whitespace in name and instruction', async () => {
    const store = new InMemoryCustomAgentStore();
    const a = await store.save({ name: '  Brief bot  ', instruction: '  do the thing  ' });
    expect(a.name).toBe('Brief bot');
    expect(a.instruction).toBe('do the thing');
  });
});
