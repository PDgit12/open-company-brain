import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseStructured, generateStructured } from '../src/brain/structured.js';

afterEach(() => vi.restoreAllMocks());
const chunks = [
  { text: 'Meals up to $60/day', source: 'expense', metadata: {}, score: 0.8 },
  { text: 'Leave policy', source: 'leave', metadata: {}, score: 0.6 },
];
const reply = (o: unknown) => JSON.stringify(o);

describe('parseStructured — code validates the model-filled schema', () => {
  it('maps valid citations (1-based) to OUR chunks and dedupes', () => {
    const r = parseStructured(reply({ status: 'answered', answer: '$60/day', citations: [1, 1] }), chunks);
    expect(r?.status).toBe('answered');
    expect(r?.citations).toHaveLength(1);
    expect(r?.citations[0]!.source).toBe('expense');
  });

  it('normalizes insufficient_context to the canonical refusal record', () => {
    const r = parseStructured(reply({ status: 'insufficient_context', answer: '', citations: [] }), chunks);
    expect(r?.status).toBe('insufficient_context');
    expect(r?.citations).toEqual([]);
  });

  it('rejects every contract violation (caller repairs)', () => {
    expect(parseStructured('not json', chunks)).toBeNull();
    expect(parseStructured(reply({ status: 'maybe', answer: 'x', citations: [1] }), chunks)).toBeNull();
    expect(parseStructured(reply({ status: 'answered', answer: '', citations: [1] }), chunks)).toBeNull();
    expect(parseStructured(reply({ status: 'answered', answer: 'x', citations: [] }), chunks)).toBeNull();
    expect(parseStructured(reply({ status: 'answered', answer: 'x', citations: [3] }), chunks)).toBeNull(); // out of range
    expect(parseStructured(reply({ status: 'answered', answer: 'x', citations: [1.5] }), chunks)).toBeNull();
  });
});

describe('generateStructured — repair loop + graceful degradation', () => {
  it('returns null on non-local backends (legacy path takes over)', async () => {
    expect(await generateStructured('p', chunks)).toBeNull(); // tests run on mock
  });
});
