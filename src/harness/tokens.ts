/**
 * Token estimation + per-scope budgeting.
 *
 * Zero-dependency by design: a chars/4 heuristic is deterministic, offline, and
 * close enough to meter usage and enforce a cap — pulling a real BPE tokenizer
 * would add a heavy dep for no decision-grade gain at this layer.
 *
 * Budgets are keyed by ACCESS SCOPE, not by a user (there is no user concept in
 * the kernel yet — only scopes). The budget is an append-only ledger of token
 * increments per scope-key; usage is their sum. Same three-tier persistence as
 * the rest of the harness: in-memory (tests) → file (zero-setup) → it rides the
 * same data dir, so a budget survives across `comb run` invocations.
 */

import path from 'node:path';
import { JsonFileCollection } from '../storage/json-file.js';
import { countTokens } from './tokenizer.js';

/**
 * Token count for budgeting + context-window packing. Delegates to the
 * configured Tokenizer seam (heuristic by default, exact BPE when configured),
 * so every caller shares one counter.
 */
export function estimateTokens(text: string): number {
  return countTokens(text);
}

/** Canonical budget key for a set of scopes — order-independent. */
export function scopeKey(scopes: string[]): string {
  return [...scopes].map((s) => s.trim()).filter(Boolean).sort().join(',') || '(none)';
}

export interface BudgetCheck {
  ok: boolean;
  used: number;
  limit: number;
  /** Tokens left before the cap (Infinity when unlimited). */
  remaining: number;
}

export interface TokenBudget {
  usage(key: string): Promise<number>;
  /** Would spending `need` tokens stay within `limit` (0 = unlimited)? */
  check(key: string, need: number, limit: number): Promise<BudgetCheck>;
  /** Record spent tokens; returns the new cumulative usage for the key. */
  record(key: string, tokens: number): Promise<number>;
}

function evaluate(used: number, need: number, limit: number): BudgetCheck {
  if (limit <= 0) return { ok: true, used, limit: 0, remaining: Infinity };
  const remaining = Math.max(0, limit - used);
  return { ok: used + need <= limit, used, limit, remaining };
}

export class InMemoryTokenBudget implements TokenBudget {
  private used = new Map<string, number>();
  async usage(key: string): Promise<number> {
    return this.used.get(key) ?? 0;
  }
  async check(key: string, need: number, limit: number): Promise<BudgetCheck> {
    return evaluate(await this.usage(key), need, limit);
  }
  async record(key: string, tokens: number): Promise<number> {
    const next = (this.used.get(key) ?? 0) + Math.max(0, tokens);
    this.used.set(key, next);
    return next;
  }
}

interface LedgerEntry {
  key: string;
  tokens: number;
  at: string;
}

export class FileTokenBudget implements TokenBudget {
  private readonly ledger: JsonFileCollection<LedgerEntry>;
  constructor(dataDir: string) {
    this.ledger = new JsonFileCollection<LedgerEntry>(path.join(dataDir, 'token-usage.json'));
  }
  async usage(key: string): Promise<number> {
    const rows = await this.ledger.read();
    return rows.filter((r) => r.key === key).reduce((n, r) => n + r.tokens, 0);
  }
  async check(key: string, need: number, limit: number): Promise<BudgetCheck> {
    return evaluate(await this.usage(key), need, limit);
  }
  async record(key: string, tokens: number): Promise<number> {
    await this.ledger.append({ key, tokens: Math.max(0, tokens), at: new Date().toISOString() });
    return this.usage(key);
  }
}

let singleton: TokenBudget | null = null;
export function getTokenBudget(dataDir: string): TokenBudget {
  if (!singleton) singleton = new FileTokenBudget(dataDir);
  return singleton;
}
