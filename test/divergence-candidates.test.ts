import { describe, it, expect } from 'vitest';
import { intentOverlap } from '../src/divergence/engine.js';

describe('model-free divergence — keyword candidate detection (no model)', () => {
  it('overlap is high when reality shares the intent vocabulary, zero when unrelated', () => {
    const intent = 'On-call acknowledges every SEV1 page within 15 minutes';
    const related = 'The SEV1 page last night went unacknowledged for 50 minutes';
    const unrelated = 'The cafeteria menu changed to add vegan options';
    expect(intentOverlap(intent, related)).toBeGreaterThan(0.3);
    expect(intentOverlap(intent, unrelated)).toBeLessThan(0.15);
  });
  it('empty intent → zero (no false candidates)', () => {
    expect(intentOverlap('', 'anything')).toBe(0);
  });
});
