import { describe, it, expect } from 'vitest';
import { ActionService } from '../src/actions/service.js';
import { InMemoryActionStore } from '../src/actions/store.js';
import { getFeedbackStore, InMemoryFeedbackStore } from '../src/feedback/feedback.js';
import type { ProposedAction } from '../src/actions/types.js';

// recordOutcome touches only the store + the feedback singleton — never the
// brain or executor — so we can construct the service with stubs for those.
const svc = (store: InMemoryActionStore): ActionService =>
  new ActionService(null as never, store, { execute: async () => ({ effect: 'x' }) } as never, {
    enabled: false,
    perHour: 20,
  });

const executed = (id: string, source: string): ProposedAction => ({
  id,
  title: 'Send notice',
  body: 'the drafted body',
  sources: [{ text: 'evidence', source }],
  status: 'executed',
  idempotencyKey: `k-${id}`,
  createdAt: new Date().toISOString(),
});

describe('Signal rung — real-world outcome feeds the reward currency', () => {
  it('an outcome event rewards exactly its grounding sources, by sign', async () => {
    const fb = new InMemoryFeedbackStore();
    await fb.record({ kind: 'outcome', query: 'a', answer: 'b', verdict: 'helpful', reward: 1, scopes: ['team'], sources: ['won-src'] });
    await fb.record({ kind: 'outcome', query: 'c', answer: 'd', verdict: 'unhelpful', reward: -1, scopes: ['team'], sources: ['lost-src'] });
    const rewards = await fb.sourceRewards(['team']);
    expect(rewards.get('won-src')).toBe(1); // a draft that worked boosts its sources
    expect(rewards.get('lost-src')).toBe(-1); // one that bounced demotes them
  });

  it('outcome rewards are scope-gated — no cross-scope leak', async () => {
    const fb = new InMemoryFeedbackStore();
    await fb.record({ kind: 'outcome', query: 'x', answer: 'y', verdict: 'helpful', reward: 1, scopes: ['secret'], sources: ['s1'] });
    expect((await fb.sourceRewards(['team'])).has('s1')).toBe(false);
  });

  it('refuses an outcome on a missing or not-yet-executed action', async () => {
    const store = new InMemoryActionStore();
    const s = svc(store);
    expect((await s.recordOutcome({ id: 'nope', outcome: 'replied' })).ok).toBe(false);
    await store.save({ ...executed('a1', 's1'), status: 'proposed' });
    const r = await s.recordOutcome({ id: 'a1', outcome: 'converted' });
    expect(r.ok).toBe(false); // can't measure what never left the system
  });

  it('records the outcome on an executed action and adjusts its sources', async () => {
    const store = new InMemoryActionStore();
    const uniq = `src-${Math.random().toString(36).slice(2)}`; // avoid singleton bleed
    await store.save(executed('a2', uniq));
    const r = await svc(store).recordOutcome({ id: 'a2', outcome: 'converted', evidence: 'closed the deal', scopes: ['team'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.reward).toBe(1);
      expect(r.action.outcome).toBe('converted');
    }
    const updated = await store.get('a2');
    expect(updated?.outcome).toBe('converted');
    expect(updated?.outcomeEvidence).toBe('closed the deal');
    // the loop closed: the global reward currency now reflects this outcome.
    expect((await getFeedbackStore().sourceRewards(['team'])).get(uniq)).toBe(1);
  });

  it('a negative outcome demotes the sources that produced it', async () => {
    const store = new InMemoryActionStore();
    const uniq = `src-${Math.random().toString(36).slice(2)}`;
    await store.save(executed('a3', uniq));
    const r = await svc(store).recordOutcome({ id: 'a3', outcome: 'error', scopes: ['team'] });
    expect(r.ok && r.reward).toBe(-1);
    expect((await getFeedbackStore().sourceRewards(['team'])).get(uniq)).toBe(-1);
  });
});
