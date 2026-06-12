import { describe, it, expect } from 'vitest';
import { compileContext } from '../src/harness/context-compiler.js';
import { cleanText, cleanDocuments } from '../src/brain/clean.js';
import { META_ACCESS } from '../src/constants.js';

describe('compileContext — one budgeted, observable assembler', () => {
  const S = (id: string, content: string, priority: number, maxTokens?: number) =>
    ({ id, content, priority, maxTokens });

  it('renders in original order; skips empties; reports per-section tokens', () => {
    const r = compileContext([S('a', 'AAAA', 1), S('skip', '  ', 9), S('b', 'BBBB', 2)], 1000);
    expect(r.prompt).toBe('AAAA\n\nBBBB');
    expect(r.sections.map((s) => s.dropped)).toEqual([false, false, false]);
    expect(r.totalTokens).toBe(2);
  });

  it('low priority is DROPPED first when the window runs out', () => {
    const r = compileContext([S('memory', 'm'.repeat(400), 5), S('instruction', 'i'.repeat(40), 10)], 10);
    const mem = r.sections.find((s) => s.id === 'memory')!;
    expect(mem.dropped).toBe(true);
    expect(r.prompt).toBe('i'.repeat(40)); // instruction survived intact
  });

  it('per-section caps truncate-to-fit and report it', () => {
    const r = compileContext([S('grounding', 'g'.repeat(400), 8, 10)], 1000);
    expect(r.sections[0]!.truncated).toBe(true);
    expect(r.sections[0]!.tokens).toBeLessThanOrEqual(10);
  });
});

describe('refinery CLEAN — deterministic, pre-embed', () => {
  it('strips control chars, trailing whitespace, blank-line and space runs', () => {
    expect(cleanText('ab  \n\n\n\nc   d\t\t e ')).toBe('ab\n\nc d e');
  });

  it('drops exact duplicates per scope; keeps cross-scope copies', () => {
    const doc = (id: string, text: string, scope: string) =>
      ({ id, text, metadata: { [META_ACCESS]: scope } });
    const out = cleanDocuments([
      doc('1', 'same  text', 'team-a'),
      doc('2', 'same text', 'team-a'), // dup after clean → dropped
      doc('3', 'same text', 'team-b'), // different scope → kept
      doc('4', '   ', 'team-a'), // empty after clean → dropped
    ]);
    expect(out.map((d) => d.id)).toEqual(['1', '3']);
    expect(out[0]!.text).toBe('same text');
  });
});
