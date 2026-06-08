/**
 * Tokenizer seam — the single place token counts come from.
 *
 * Default is a zero-dependency heuristic (~4 chars/token): deterministic,
 * offline, and good enough to meter budgets and pack the context window. When
 * exactness matters, set COMB_TOKENIZER=bpe and install the optional
 * `gpt-tokenizer` package — a pure-JS BPE tokenizer. Honest caveat: BPE is
 * EXACT for OpenAI vocabularies (cl100k/o200k) but only APPROXIMATE for llama
 * (different vocab); it's still far closer than chars/4. If the package isn't
 * installed, we transparently fall back to the heuristic.
 *
 * estimateTokens() (in tokens.ts) delegates here, so budgeting and
 * context-window packing both use whichever counter is configured.
 */

import { createRequire } from 'node:module';
import { config } from '../config.js';

export interface Tokenizer {
  readonly name: 'heuristic' | 'bpe';
  count(text: string): number;
}

export class HeuristicTokenizer implements Tokenizer {
  readonly name = 'heuristic' as const;
  count(text: string): number {
    return text ? Math.ceil(text.length / 4) : 0;
  }
}

export class BpeTokenizer implements Tokenizer {
  readonly name = 'bpe' as const;
  constructor(private readonly encode: (text: string) => number[]) {}
  count(text: string): number {
    return text ? this.encode(text).length : 0;
  }
}

/** Try to load the optional pure-JS BPE encoder. Returns null if unavailable. */
export function loadBpeTokenizer(): BpeTokenizer | null {
  try {
    // Synchronous require so count() stays sync; guarded so a missing optional
    // dependency degrades gracefully instead of throwing at import time.
    const require = createRequire(import.meta.url);
    const mod = require('gpt-tokenizer') as { encode?: (t: string) => number[]; default?: { encode?: (t: string) => number[] } };
    const encode = mod.encode ?? mod.default?.encode;
    return typeof encode === 'function' ? new BpeTokenizer(encode) : null;
  } catch {
    return null;
  }
}

let active: Tokenizer | null = null;
let warned = false;

/** The resolved, process-wide tokenizer (heuristic unless bpe is configured). */
export function getTokenizer(): Tokenizer {
  if (active) return active;
  if (config.comb.tokenizer === 'bpe') {
    const bpe = loadBpeTokenizer();
    if (bpe) {
      active = bpe;
    } else {
      if (!warned) {
        warned = true;
        console.warn('[comb] COMB_TOKENIZER=bpe but `gpt-tokenizer` is not installed — using the heuristic. Run `npm i gpt-tokenizer`.');
      }
      active = new HeuristicTokenizer();
    }
  } else {
    active = new HeuristicTokenizer();
  }
  return active;
}

/** Reset the cached tokenizer — for tests that flip the config. */
export function resetTokenizer(): void {
  active = null;
  warned = false;
}

export function countTokens(text: string): number {
  return getTokenizer().count(text);
}
