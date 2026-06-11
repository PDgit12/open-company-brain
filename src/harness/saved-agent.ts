/**
 * SavedAgent — run a no-code custom agent definition on the harness.
 *
 * A saved agent is just a stored prompt (name + instruction + retrieval query).
 * Running one is a single grounded `brain.draft`: retrieve for the definition's
 * query (refined by the user's runtime request), then generate under the saved
 * instruction. It inherits citations + cite-or-refuse for free, exactly like the
 * dashboard's no-code agents — now reachable from the operator CLI too.
 *
 * Because a saved agent has a STABLE id, it is the natural anchor for per-agent
 * conversation memory (Phase 2) and deterministic caching/budgeting (Phase 3),
 * which layer in through this one adapter without touching the generic agents.
 */

import type { CustomAgent } from '../agents/registry.js';
import { formatMemory, type AgentMemory } from '../agents/conversation.js';
import { cacheKey, type ResponseCache } from './cache.js';
import { estimateTokens, scopeKey, type TokenBudget } from './tokens.js';
import type { Agent, AgentContext, AgentResult } from './agent.js';

/** Stitch the cited sources onto generated text, matching BuiltinAgent's shape. */
export function withSources(text: string, sources: { source: string }[]): string {
  const cites = [...new Set(sources.map((s) => s.source))];
  return cites.length ? `${text}\n\nSources: ${cites.map((s) => `[${s}]`).join(' ')}` : text;
}

/**
 * Retrieval query for a run: the USER's request when present, else the saved
 * query (for empty/scheduled runs). Deliberately NOT a composite — mixing the
 * definition's topic terms into retrieval inflates similarity scores with
 * always-present corpus matches, which defeats the grounding gate: an
 * unanswerable request would still clear the calibrated floor on the strength
 * of the saved keywords alone. The gate must judge what the user actually asked.
 */
export function runQuery(def: CustomAgent, task: string): string {
  return task.trim() || def.query;
}

/**
 * Instruction for a run: the saved instruction, any prior conversation (so the
 * agent retains context across runs/sessions), then the user's specific ask.
 */
export function runInstruction(def: CustomAgent, task: string, memoryBlock = ''): string {
  const t = task.trim();
  const parts = [def.instruction];
  if (memoryBlock) parts.push(memoryBlock);
  if (t) parts.push(`User request: ${t}`);
  return parts.join('\n\n');
}

export interface SavedAgentOptions {
  /** Per-agent memory binding. When present, the run is context-retaining. */
  memory?: AgentMemory;
  /** Response cache for the deterministic (memory-less) path. */
  cache?: ResponseCache;
  /** Model id mixed into the cache key (so a model swap doesn't reuse answers). */
  cacheModel?: string;
  /** Per-scope token budget meter. */
  budget?: TokenBudget;
  /** Token cap per scope (0 = unlimited). */
  budgetLimit?: number;
  /** Tokens conversation memory may occupy in the prompt (0 = no trim). */
  memoryTokenBudget?: number;
}

export class SavedAgent implements Agent {
  readonly name: string;
  constructor(
    private readonly def: CustomAgent,
    private readonly opts: SavedAgentOptions = {},
  ) {
    this.name = `saved:${def.name}`;
  }

  async run(task: string, ctx: AgentContext): Promise<AgentResult> {
    ctx.onStatus?.('thinking');
    const { memory, cache, budget } = this.opts;
    const priorTurns = memory ? await memory.recent() : [];
    const query = runQuery(this.def, task);
    // Pack memory to fit the context window — oldest turns drop first.
    const memoryBlock = formatMemory(priorTurns, this.opts.memoryTokenBudget ?? 0);
    const instruction = runInstruction(this.def, task, memoryBlock);
    const key = scopeKey(ctx.scopes);

    // Budget gate — refuse (don't generate) when the scope's cap is exhausted.
    if (budget) {
      const need = estimateTokens(`${query}\n${instruction}`);
      const chk = await budget.check(key, need, this.opts.budgetLimit ?? 0);
      if (!chk.ok) {
        return {
          output:
            `Token budget for scope "${key}" is exhausted (${chk.used}/${chk.limit} tokens). ` +
            `Run \`comb budget\` to review, or raise COMB_TOKEN_BUDGET_PER_SCOPE.`,
          steps: [],
        };
      }
    }

    // Deterministic path (no conversation memory): cacheable. A memory-carrying
    // run embeds prior dialogue, so its prompt is unique — never cached.
    const cacheable = !memory && cache;
    if (cacheable) {
      const k = cacheKey({ model: this.opts.cacheModel ?? '', scopes: ctx.scopes, query, instruction });
      const hit = await cache.get(k);
      if (hit !== undefined) return { output: hit, steps: [] }; // cache hit: zero token spend
      const { text, sources } = await ctx.brain.draft(query, instruction, ctx.scopes);
      const output = withSources(text, sources);
      await cache.set(k, output);
      if (budget) await budget.record(key, estimateTokens(`${query}\n${instruction}\n${text}`));
      return { output, steps: [] };
    }

    // Context-retaining path: generate, persist the exchange, meter usage.
    // Memory hygiene: only a GROUNDED exchange is remembered (sources prove
    // grounding post-gate; refusals carry none) — poison never enters memory.
    const { text, sources } = await ctx.brain.draft(query, instruction, ctx.scopes);
    const output = withSources(text, sources);
    if (memory && task.trim()) await memory.remember(task.trim(), text, sources.length > 0);
    if (budget) await budget.record(key, estimateTokens(`${query}\n${instruction}\n${text}`));
    return { output, steps: [] };
  }
}
