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

import { runStructuredPipeline, parseSelect, type Llm } from '../src/brain/structured.js';

describe('parseSelect — selection validation', () => {
  it('accepts in-range unique indexes incl. empty; rejects junk', () => {
    expect(parseSelect('{"relevant":[1,2,1]}', 2)).toEqual([1, 2]);
    expect(parseSelect('{"relevant":[]}', 2)).toEqual([]);
    expect(parseSelect('{"relevant":[3]}', 2)).toBeNull();
    expect(parseSelect('{"relevant":"x"}', 2)).toBeNull();
    expect(parseSelect('nope', 2)).toBeNull();
  });
});

describe('runStructuredPipeline — SELECT then COMPOSE (injected model)', () => {
  it('empty selection → STRUCTURAL refusal, compose never called', async () => {
    const calls: string[] = [];
    const llm: Llm = async (sys) => { calls.push(sys.slice(0, 10)); return '{"relevant":[]}'; };
    const r = await runStructuredPipeline(llm, 'q', chunks);
    expect(r?.status).toBe('insufficient_context');
    expect(calls).toHaveLength(1); // SELECT only
  });

  it('selection narrows the compose context; citations map back to ORIGINAL chunks', async () => {
    const seen: string[] = [];
    const llm: Llm = async (_sys, prompt, schema) => {
      seen.push(prompt);
      if ((schema as { properties: object }).properties.hasOwnProperty('relevant')) return '{"relevant":[2]}';
      return '{"status":"answered","answer":"leave info","citations":[1]}'; // #1 of the SELECTED set
    };
    const r = await runStructuredPipeline(llm, 'q', chunks);
    expect(r?.status).toBe('answered');
    expect(r?.citations[0]!.source).toBe('leave'); // original chunk #2
    expect(seen[1]).not.toContain('Meals up to $60'); // distractor excluded from compose
  });

  it('invalid SELECT degrades to single-shot compose over ALL chunks', async () => {
    const llm: Llm = async (_sys, _p, schema) =>
      (schema as { properties: object }).properties.hasOwnProperty('relevant')
        ? 'garbage'
        : '{"status":"answered","answer":"x","citations":[1]}';
    const r = await runStructuredPipeline(llm, 'q', chunks);
    expect(r?.citations[0]!.source).toBe('expense'); // indexed against the FULL set
  });
});
