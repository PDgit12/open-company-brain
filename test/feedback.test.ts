import { describe, it, expect } from 'vitest';
import { InMemoryFeedbackStore, rewardFor, rerankByReward } from '../src/feedback/feedback.js';

describe('feedback substrate', () => {
  it('maps verdicts to a normalized reward', () => {
    expect(rewardFor('approved')).toBe(1);
    expect(rewardFor('helpful')).toBe(1);
    expect(rewardFor('rejected')).toBe(-1);
    expect(rewardFor('unhelpful')).toBe(-1);
  });

  it('returns approved examples similar to the query', async () => {
    const store = new InMemoryFeedbackStore();
    await store.record({ kind: 'answer', query: 'Aerodyne renewal status', answer: 'Renewed, Platinum tier.', verdict: 'approved', scopes: ['default-team'] });
    await store.record({ kind: 'answer', query: 'unrelated weather question', answer: 'Sunny.', verdict: 'approved', scopes: ['default-team'] });

    const ex = await store.approvedExamples('what is the Aerodyne renewal', ['default-team'], 2);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex[0]!.query).toContain('Aerodyne');
  });

  it('does NOT return rejected answers as exemplars', async () => {
    const store = new InMemoryFeedbackStore();
    await store.record({ kind: 'answer', query: 'Aerodyne', answer: 'wrong', verdict: 'rejected', scopes: ['default-team'] });
    const ex = await store.approvedExamples('Aerodyne', ['default-team'], 2);
    expect(ex).toHaveLength(0);
  });

  it('scope-gates exemplars: a leadership example never leaks to default-team', async () => {
    const store = new InMemoryFeedbackStore();
    await store.record({ kind: 'answer', query: 'confidential mandate', answer: 'secret', verdict: 'approved', scopes: ['leadership'] });
    const denied = await store.approvedExamples('confidential mandate', ['default-team'], 2);
    expect(denied).toHaveLength(0);
    const allowed = await store.approvedExamples('confidential mandate', ['default-team', 'leadership'], 2);
    expect(allowed.length).toBeGreaterThan(0);
  });

  it('never surfaces approved actions as Q&A exemplars', async () => {
    const store = new InMemoryFeedbackStore();
    await store.record({ kind: 'action', query: 'draft-email for Aerodyne', answer: '{"to":"x@y.com"}', verdict: 'approved', scopes: [] });
    const ex = await store.approvedExamples('draft-email for Aerodyne', ['default-team'], 2);
    expect(ex).toHaveLength(0);
  });

  it('does not let an unscoped answer bypass the scope gate', async () => {
    const store = new InMemoryFeedbackStore();
    await store.record({ kind: 'answer', query: 'Aerodyne', answer: 'open', verdict: 'approved', scopes: [] });
    const ex = await store.approvedExamples('Aerodyne', ['default-team'], 2);
    expect(ex).toHaveLength(0);
  });
});

describe('reranker (per-source reward)', () => {
  it('accumulates scope-gated reward per cited source', async () => {
    const store = new InMemoryFeedbackStore();
    await store.record({ kind: 'answer', query: 'q1', answer: 'good', verdict: 'approved', scopes: ['default-team'], sources: ['companies'] });
    await store.record({ kind: 'answer', query: 'q2', answer: 'good', verdict: 'helpful', scopes: ['default-team'], sources: ['companies'] });
    await store.record({ kind: 'answer', query: 'q3', answer: 'bad', verdict: 'rejected', scopes: ['default-team'], sources: ['engagements'] });
    // Leadership-scoped signal must not bleed into a default-team ranking.
    await store.record({ kind: 'answer', query: 'q4', answer: 'secret', verdict: 'approved', scopes: ['leadership'], sources: ['mandates'] });

    const rewards = await store.sourceRewards(['default-team']);
    expect(rewards.get('companies')).toBe(2);
    expect(rewards.get('engagements')).toBe(-1);
    expect(rewards.has('mandates')).toBe(false);
  });

  it('reorders equally-relevant chunks by reward and demotes rejected sources', () => {
    const chunks = [
      { source: 'engagements', score: 0.5 },
      { source: 'companies', score: 0.5 },
      { source: 'contacts', score: 0.5 },
    ];
    const rewards = new Map([['companies', 3], ['engagements', -3]]);
    const ranked = rerankByReward(chunks, rewards);
    expect(ranked.map((c) => c.source)).toEqual(['companies', 'contacts', 'engagements']);
  });

  it('leaves ranking unchanged when a source has no reward', () => {
    const chunks = [
      { source: 'a', score: 0.9 },
      { source: 'b', score: 0.4 },
    ];
    const ranked = rerankByReward(chunks, new Map());
    expect(ranked.map((c) => c.source)).toEqual(['a', 'b']);
  });
});
