import { describe, it, expect, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FileConversationStore,
  InMemoryConversationStore,
  bindMemory,
  fitTurns,
  formatMemory,
  type ConversationTurn,
} from '../src/agents/conversation.js';
import { InMemoryResponseCache } from '../src/harness/cache.js';
import { InMemoryTokenBudget } from '../src/harness/tokens.js';
import { SavedAgent } from '../src/harness/saved-agent.js';
import { answered, refusal } from '../src/brain/record.js';
import type { CustomAgent } from '../src/agents/registry.js';
import type { AgentContext } from '../src/harness/agent.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-convo-'));
const turn = (role: 'user' | 'assistant', content: string): ConversationTurn => ({
  role, content, at: new Date().toISOString(), grounded: true,
});

const def: CustomAgent = {
  id: 'agent_test', name: 'Memo', instruction: 'Be helpful.', query: 'stuff',
  createdAt: new Date().toISOString(),
};

/** A brain stub that records the instruction it's asked to draft under. */
function spyBrain() {
  const seen: string[] = [];
  const brain = {
    draft: vi.fn(async (_q: string, instruction: string) => {
      seen.push(instruction);
      const chunks = [{ text: 'x', source: 'doc', metadata: {}, score: 1 }];
      return { text: `answer ${seen.length}`, sources: chunks, record: answered(`answer ${seen.length}`, chunks) };
    }),
  };
  return { brain: brain as unknown as AgentContext['brain'], seen };
}

describe('ConversationStore — per-agent memory', () => {
  it('in-memory append/history/clear is isolated per agent', async () => {
    const store = new InMemoryConversationStore();
    await store.append('a', turn('user', 'hi'));
    await store.append('a', turn('assistant', 'hello'));
    await store.append('b', turn('user', 'other'));
    expect(await store.history('a')).toHaveLength(2);
    expect(await store.history('b')).toHaveLength(1);
    await store.clear('a');
    expect(await store.history('a')).toEqual([]);
    expect(await store.history('b')).toHaveLength(1);
  });

  it('history(limit) returns only the most recent turns', async () => {
    const store = new InMemoryConversationStore();
    for (let i = 0; i < 5; i++) await store.append('a', turn('user', `m${i}`));
    const recent = await store.history('a', 2);
    expect(recent.map((t) => t.content)).toEqual(['m3', 'm4']);
  });

  it('file store persists across instances and clears cleanly', async () => {
    const dir = await tempDir();
    const s1 = new FileConversationStore(dir);
    await s1.append('a', turn('user', 'remember this'));
    await s1.append('a', turn('assistant', 'ok'));

    // A fresh instance (a later process) sees the history.
    const s2 = new FileConversationStore(dir);
    expect(await s2.history('a')).toHaveLength(2);
    expect((await s2.history('a'))[0]!.content).toBe('remember this');

    await s2.clear('a');
    expect(await new FileConversationStore(dir).history('a')).toEqual([]);
  });
});

describe('bindMemory + formatMemory', () => {
  it('remember() writes a user turn then an assistant turn (grounded)', async () => {
    const store = new InMemoryConversationStore();
    const mem = bindMemory(store, 'a');
    await mem.remember('what is X?', 'X is Y.', true);
    const turns = await mem.recent();
    expect(turns.map((t) => [t.role, t.content])).toEqual([
      ['user', 'what is X?'],
      ['assistant', 'X is Y.'],
    ]);
  });

  it('HYGIENE: an ungrounded exchange is never stored — poison cannot enter memory', async () => {
    const store = new InMemoryConversationStore();
    const mem = bindMemory(store, 'a');
    await mem.remember('unknowable?', "I don't have that in the brain yet.", false);
    expect(await mem.recent()).toEqual([]);
  });

  it('HYGIENE: legacy/unmarked turns are auto-invalidated for replay', async () => {
    const store = new InMemoryConversationStore();
    // A pre-hygiene row: no grounded field (how poisoned history looks).
    await store.append('a', { role: 'assistant', content: 'old hallucination', at: new Date().toISOString() });
    await store.append('a', turn('assistant', 'grounded fact'));
    const replayed = await store.history('a');
    expect(replayed.map((t) => t.content)).toEqual(['grounded fact']);
  });

  it('formatMemory renders turns and is empty for no history', () => {
    expect(formatMemory([])).toBe('');
    const block = formatMemory([turn('user', 'hi'), turn('assistant', 'yo')]);
    expect(block).toContain('CONVERSATION SO FAR:');
    expect(block).toContain('User: hi');
    expect(block).toContain('Agent: yo');
  });
});

describe('fitTurns — context-window packing', () => {
  const turns = Array.from({ length: 6 }, () => turn('user', 'x'.repeat(40))); // ~10 tok + 8 each
  it('keeps only the most recent turns that fit the budget, in order', () => {
    const fitted = fitTurns(turns, 40); // room for ~2 turns (~18 tok each)
    expect(fitted.length).toBeLessThan(turns.length);
    expect(fitted.length).toBeGreaterThan(0);
    // It keeps the TAIL (most recent), still oldest-first.
    expect(fitted).toEqual(turns.slice(turns.length - fitted.length));
  });
  it('returns [] for a zero/negative budget and all turns for a huge budget', () => {
    expect(fitTurns(turns, 0)).toEqual([]);
    expect(fitTurns(turns, 100_000)).toHaveLength(6);
  });
  it('formatMemory(maxTokens) trims the rendered block', () => {
    const full = formatMemory(turns);
    const trimmed = formatMemory(turns, 40);
    expect(trimmed.length).toBeLessThan(full.length);
    expect(trimmed).toContain('CONVERSATION SO FAR:');
  });
});

describe('SavedAgent — token budget + response cache', () => {
  it('refuses to generate when the scope budget is exhausted', async () => {
    const budget = new InMemoryTokenBudget();
    await budget.record('default-team', 1000); // already spent
    const agent = new SavedAgent(def, { budget, budgetLimit: 500 });
    const { brain } = spyBrain();
    const ctx = { brain, fabric: { list: () => [] }, scopes: ['default-team'] } as unknown as AgentContext;
    const r = await agent.run('anything', ctx);
    expect(r.output).toContain('budget');
    expect((brain as unknown as { draft: { mock: { calls: unknown[] } } }).draft.mock.calls).toHaveLength(0);
  });

  it('serves a cached answer on the deterministic (memory-less) path without re-generating', async () => {
    const cache = new InMemoryResponseCache(3600);
    const agent = new SavedAgent(def, { cache, cacheModel: 'm' });
    const { brain, seen } = spyBrain();
    const ctx = { brain, fabric: { list: () => [] }, scopes: ['default-team'] } as unknown as AgentContext;

    const first = await agent.run('same question', ctx); // miss → generates
    const second = await agent.run('same question', ctx); // hit → no generation
    expect(seen).toHaveLength(1); // brain.draft called exactly once
    expect(second.output).toBe(first.output);
  });
});

describe('SavedAgent — context retention across runs', () => {
  it('persists each exchange and replays prior turns into the next prompt', async () => {
    const store = new InMemoryConversationStore();
    const agent = new SavedAgent(def, { memory: bindMemory(store, def.id) });
    const { brain, seen } = spyBrain();
    const ctx = { brain, fabric: { list: () => [] }, scopes: ['default-team'] } as unknown as AgentContext;

    // First run: no prior memory in the instruction.
    await agent.run('first question', ctx);
    expect(seen[0]).not.toContain('CONVERSATION SO FAR');
    expect(await store.history(def.id)).toHaveLength(2); // user + assistant persisted

    // Second run: the first exchange is now replayed into the prompt.
    await agent.run('second question', ctx);
    expect(seen[1]).toContain('CONVERSATION SO FAR');
    expect(seen[1]).toContain('first question');
    expect(seen[1]).toContain('answer 1');
    expect(await store.history(def.id)).toHaveLength(4);
  });

  it('memory-vs-grounding: a refused query with grounded memory answers FROM MEMORY, marked and unstored', async () => {
    const store = new InMemoryConversationStore();
    const agent = new SavedAgent(def, { memory: bindMemory(store, def.id) });
    // Brain stub: first draft grounds; second REFUSES (no sources); converse echoes.
    let calls = 0;
    const brain = {
      draft: async () => {
        const chunks = [{ text: 'x', source: 'doc', metadata: {}, score: 1 }];
        return ++calls === 1
          ? { text: 'grounded answer', sources: chunks, record: answered('grounded answer', chunks) }
          : { text: "I don't have that in the brain yet.", sources: [], record: refusal() };
      },
      converse: async (_i: string, conversation: string) => `you asked about: ${conversation.includes('first question') ? 'first question' : '?'}`,
    } as unknown as AgentContext['brain'];
    const ctx = { brain, fabric: { list: () => [] }, scopes: ['default-team'] } as unknown as AgentContext;

    await agent.run('first question', ctx); // grounded → remembered
    const r = await agent.run('what did I just ask you?', ctx); // refused → memory fallback
    expect(r.output).toContain('first question');
    expect(r.output).toContain('(from conversation memory');
    expect(r.output).not.toMatch(/Sources:/); // never masquerades as grounded
    // The derivative exchange is NOT stored — memory still holds only run 1.
    expect(await store.history(def.id)).toHaveLength(2);
  });

  it('memory-vs-grounding: with NO grounded memory, a refused query still refuses', async () => {
    const store = new InMemoryConversationStore();
    const agent = new SavedAgent(def, { memory: bindMemory(store, def.id) });
    const brain = {
      draft: async () => ({ text: "I don't have that in the brain yet.", sources: [], record: refusal() }),
      converse: async () => { throw new Error('must not be called with empty memory'); },
    } as unknown as AgentContext['brain'];
    const ctx = { brain, fabric: { list: () => [] }, scopes: ['default-team'] } as unknown as AgentContext;
    const r = await agent.run('unknowable thing', ctx);
    expect(r.output).toContain("I don't have that in the brain yet.");
  });

  it('without a memory binding, runs are stateless (no persistence)', async () => {
    const agent = new SavedAgent(def); // no memory
    const { brain, seen } = spyBrain();
    const ctx = { brain, fabric: { list: () => [] }, scopes: ['default-team'] } as unknown as AgentContext;
    await agent.run('q1', ctx);
    await agent.run('q2', ctx);
    expect(seen.every((s) => !s.includes('CONVERSATION SO FAR'))).toBe(true);
  });
});
