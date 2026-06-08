import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FileCustomAgentStore,
  InMemoryCustomAgentStore,
  resolveAgent,
} from '../src/agents/registry.js';
import { Brain } from '../src/brain/brain.js';
import { createFabric } from '../src/tools/assemble.js';
import { SavedAgent, runQuery, runInstruction } from '../src/harness/saved-agent.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-agents-'));

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

/** The zero-setup default: saved agents must survive a process exit (a file). */
describe('FileCustomAgentStore — durable, zero-setup persistence', () => {
  it('persists a saved agent to disk and reloads it via a fresh store', async () => {
    const dir = await tempDir();
    const a = await new FileCustomAgentStore(dir).save({
      name: 'Renewals',
      instruction: 'List upcoming renewals.',
      query: 'renewal date tier',
    });

    // A brand-new store instance (simulating a later `comb run`) sees it.
    const reopened = new FileCustomAgentStore(dir);
    const all = await reopened.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: a.id, name: 'Renewals', query: 'renewal date tier' });
    expect(await reopened.get(a.id)).toMatchObject({ name: 'Renewals' });

    // It's a real, well-formed JSON file on disk.
    const raw = JSON.parse(await readFile(path.join(dir, 'agents.json'), 'utf8'));
    expect(raw).toHaveLength(1);
  });

  it('mints unique ids across separate save calls (no process-counter collision)', async () => {
    const store = new FileCustomAgentStore(await tempDir());
    const a = await store.save({ name: 'A', instruction: 'x' });
    const b = await store.save({ name: 'B', instruction: 'y' });
    expect(a.id).not.toBe(b.id);
    expect(await store.list()).toHaveLength(2);
  });

  it('returns [] for a missing collection file rather than throwing', async () => {
    expect(await new FileCustomAgentStore(await tempDir()).list()).toEqual([]);
  });
});

describe('resolveAgent — id or case-insensitive name', () => {
  it('resolves by id and by name, and returns undefined for a miss', async () => {
    const store = new InMemoryCustomAgentStore();
    const a = await store.save({ name: 'Risk Scan', instruction: 'Flag risks.' });
    expect(await resolveAgent(store, a.id)).toMatchObject({ id: a.id });
    expect(await resolveAgent(store, 'risk scan')).toMatchObject({ id: a.id });
    expect(await resolveAgent(store, 'nope')).toBeUndefined();
  });
});

describe('SavedAgent — runs a definition on the governed kernel', () => {
  it('composes query + instruction from the definition and the runtime request', async () => {
    const def = await new InMemoryCustomAgentStore().save({
      name: 'Renewals',
      instruction: 'List upcoming renewals.',
      query: 'renewal date tier',
    });
    expect(runQuery(def, 'for Q3')).toBe('renewal date tier for Q3');
    expect(runQuery(def, '')).toBe('renewal date tier');
    expect(runInstruction(def, 'for Q3')).toContain('User request: for Q3');
    expect(runInstruction(def, '')).toBe('List upcoming renewals.');
  });

  it('produces a grounded, cited answer through brain.draft', async () => {
    const def = await new InMemoryCustomAgentStore().save({
      name: 'Atlas brief',
      instruction: 'Summarize the migration.',
      query: 'Project Atlas migration',
    });
    const brain = await Brain.create();
    const fabric = await createFabric(brain, { servers: [] });
    const r = await new SavedAgent(def).run('what is the status', {
      brain, fabric, scopes: ['default-team'],
    });
    expect(r.output).toMatch(/Sources:/);
    await fabric.close();
  });
});
