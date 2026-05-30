import { describe, it, expect } from 'vitest';
import { InMemoryFeedbackStore, rewardFor } from '../src/feedback/feedback.js';

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
