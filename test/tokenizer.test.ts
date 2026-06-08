import { describe, it, expect } from 'vitest';
import {
  HeuristicTokenizer,
  BpeTokenizer,
  loadBpeTokenizer,
  getTokenizer,
  countTokens,
} from '../src/harness/tokenizer.js';
import { estimateTokens } from '../src/harness/tokens.js';

describe('HeuristicTokenizer — chars/4, zero-dep', () => {
  it('counts deterministically and handles empty', () => {
    const t = new HeuristicTokenizer();
    expect(t.name).toBe('heuristic');
    expect(t.count('')).toBe(0);
    expect(t.count('abcd')).toBe(1);
    expect(t.count('abcde')).toBe(2);
  });
});

describe('BpeTokenizer — delegates to an injected encoder', () => {
  it('counts tokens via the encoder, zero for empty', () => {
    const fake = (s: string) => s.split(' '); // 1 "token" per word
    const t = new BpeTokenizer(fake as unknown as (s: string) => number[]);
    expect(t.name).toBe('bpe');
    expect(t.count('')).toBe(0);
    expect(t.count('one two three')).toBe(3);
  });
});

describe('tokenizer resolution', () => {
  it('defaults to the heuristic and countTokens/estimateTokens share it', () => {
    expect(getTokenizer().name).toBe('heuristic');
    expect(countTokens('abcde')).toBe(2);
    expect(estimateTokens('abcde')).toBe(2); // delegates to the same seam
  });

  it('loadBpeTokenizer returns a BpeTokenizer or null (optional dep)', () => {
    const bpe = loadBpeTokenizer();
    expect(bpe === null || bpe instanceof BpeTokenizer).toBe(true);
  });
});
