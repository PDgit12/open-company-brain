import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  InMemoryRunStore,
  FileRunStore,
  toRecord,
  tracedRun,
  type RunStore,
} from '../src/observability/runs.js';
import type { Agent, AgentContext, AgentResult } from '../src/harness/agent.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-runs-'));

const result = (output: string, tools: string[] = []): AgentResult => ({
  output,
  steps: tools.map((t) => ({ tool: t, args: { q: 'x' }, result: 'ok' })),
});

const stubAgent = (name: string, r: AgentResult): Agent => ({ name, run: async () => r });
const ctx = (scopes: string[]): AgentContext => ({ scopes } as unknown as AgentContext);

describe('toRecord — trace with token + latency metrics', () => {
  it('captures agent, scopes, steps, and token counts', () => {
    const rec = toRecord('builtin', ['team'], 'a question', result('an answer', ['brain.search']), 42);
    expect(rec.id).toMatch(/^run_/);
    expect(rec.agent).toBe('builtin');
    expect(rec.scopes).toEqual(['team']);
    expect(rec.steps).toHaveLength(1);
    expect(rec.promptTokens).toBeGreaterThan(0);
    expect(rec.outputTokens).toBeGreaterThan(0);
    expect(rec.latencyMs).toBe(42);
  });
});

describe('RunStore — list newest-first, limit, get', () => {
  const exercise = async (store: RunStore) => {
    for (let i = 0; i < 5; i++) {
      await store.append(toRecord('builtin', ['team'], `q${i}`, result(`a${i}`), i));
    }
    const recent = await store.list(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.input).toBe('q4'); // newest first
    const all = await store.list(50);
    expect(await store.get(all[0]!.id)).toMatchObject({ input: 'q4' });
    expect(await store.get('nope')).toBeUndefined();
  };

  it('in-memory', async () => exercise(new InMemoryRunStore()));
  it('file-backed persists across instances', async () => {
    const dir = await tempDir();
    await exercise(new FileRunStore(dir));
    // A fresh instance still sees the runs.
    expect((await new FileRunStore(dir).list(50)).length).toBe(5);
  });
});

describe('tracedRun — records a trace, never breaks the run', () => {
  it('persists the run and returns the result unchanged', async () => {
    const store = new InMemoryRunStore();
    const r = await tracedRun(stubAgent('builtin', result('hi', ['brain.search'])), 'task', ctx(['team']), store);
    expect(r.output).toBe('hi');
    const runs = await store.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agent: 'builtin', input: 'task' });
  });

  it('swallows a store failure (observability must not fail the run)', async () => {
    const brokenStore: RunStore = {
      append: async () => { throw new Error('disk full'); },
      list: async () => [],
      get: async () => undefined,
    };
    const r = await tracedRun(stubAgent('builtin', result('still works')), 'task', ctx(['team']), brokenStore);
    expect(r.output).toBe('still works');
  });
});
