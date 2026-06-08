import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  estimateTokens,
  scopeKey,
  InMemoryTokenBudget,
  FileTokenBudget,
} from '../src/harness/tokens.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-tokens-'));

describe('estimateTokens — chars/4 heuristic', () => {
  it('is zero for empty and rounds up otherwise', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('scopeKey — order-independent canonical key', () => {
  it('sorts, trims, and normalizes empties', () => {
    expect(scopeKey(['b', 'a'])).toBe('a,b');
    expect(scopeKey(['  team  ', ''])).toBe('team');
    expect(scopeKey([])).toBe('(none)');
  });
});

describe('TokenBudget — per-scope metering and caps', () => {
  it('records cumulative usage and enforces a cap (in-memory)', async () => {
    const b = new InMemoryTokenBudget();
    expect(await b.usage('k')).toBe(0);
    await b.record('k', 100);
    await b.record('k', 50);
    expect(await b.usage('k')).toBe(150);

    const within = await b.check('k', 40, 200);
    expect(within.ok).toBe(true);
    expect(within.remaining).toBe(50);

    const over = await b.check('k', 60, 200);
    expect(over.ok).toBe(false);
  });

  it('treats limit 0 as unlimited', async () => {
    const b = new InMemoryTokenBudget();
    await b.record('k', 1_000_000);
    const chk = await b.check('k', 999, 0);
    expect(chk.ok).toBe(true);
    expect(chk.remaining).toBe(Infinity);
  });

  it('file-backed budget persists usage across instances', async () => {
    const dir = await tempDir();
    await new FileTokenBudget(dir).record('team', 120);
    expect(await new FileTokenBudget(dir).usage('team')).toBe(120);
    await new FileTokenBudget(dir).record('team', 30);
    expect(await new FileTokenBudget(dir).usage('team')).toBe(150);
    // Different scope keys are isolated.
    expect(await new FileTokenBudget(dir).usage('other')).toBe(0);
  });
});
