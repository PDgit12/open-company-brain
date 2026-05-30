import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';
import { GOLDEN_SET, candidateCasesFromFeedback } from '../src/eval/golden.js';
import { evaluateCase } from '../src/eval/run.js';
import { NO_CONTEXT_REPLY } from '../src/agents/generator.js';
import type { FeedbackEvent } from '../src/feedback/feedback.js';

/** The golden eval set, asserted so behavioural regressions fail CI. */
describe('golden eval set', () => {
  it.each(GOLDEN_SET.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const brain = await Brain.create();
    const result = await evaluateCase(brain, c);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe('auto-grown eval candidates (from rejected feedback)', () => {
  const ev = (e: Partial<FeedbackEvent>): FeedbackEvent => ({
    id: 'x', at: '', kind: 'answer', query: 'q', answer: 'a',
    verdict: 'rejected', scopes: ['default-team'], reward: -1, ...e,
  });

  it('turns a rejected refusal into a has_sources regression case', () => {
    const cases = candidateCasesFromFeedback(
      [ev({ query: 'history with Aerodyne', answer: NO_CONTEXT_REPLY })],
      ['default-team'],
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]!.source).toBe('feedback');
    expect(cases[0]!.input).toBe('history with Aerodyne');
    expect(cases[0]!.checks).toEqual([{ check: 'has_sources' }]);
  });

  it('ignores approved answers and wrong-but-answered (non-refusal) rejections', () => {
    const cases = candidateCasesFromFeedback(
      [
        ev({ verdict: 'approved', reward: 1, answer: NO_CONTEXT_REPLY }),
        ev({ answer: 'a confidently wrong answer with content' }),
      ],
      ['default-team'],
    );
    expect(cases).toHaveLength(0);
  });

  it('scope-gates: a leadership-scoped failure never leaks to default-team', () => {
    const events = [ev({ query: 'confidential mandate', answer: NO_CONTEXT_REPLY, scopes: ['leadership'] })];
    expect(candidateCasesFromFeedback(events, ['default-team'])).toHaveLength(0);
    expect(candidateCasesFromFeedback(events, ['leadership'])).toHaveLength(1);
  });

  it('de-duplicates repeated failing queries', () => {
    const cases = candidateCasesFromFeedback(
      [
        ev({ query: 'same query', answer: NO_CONTEXT_REPLY }),
        ev({ query: 'Same Query', answer: NO_CONTEXT_REPLY }),
      ],
      ['default-team'],
    );
    expect(cases).toHaveLength(1);
  });
});
