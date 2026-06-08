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
import type { Agent, AgentContext, AgentResult } from './agent.js';

/** Stitch the cited sources onto generated text, matching BuiltinAgent's shape. */
export function withSources(text: string, sources: { source: string }[]): string {
  const cites = [...new Set(sources.map((s) => s.source))];
  return cites.length ? `${text}\n\nSources: ${cites.map((s) => `[${s}]`).join(' ')}` : text;
}

/** Retrieval query for a run: the saved query, sharpened by the user's request. */
export function runQuery(def: CustomAgent, task: string): string {
  const t = task.trim();
  return t ? `${def.query} ${t}`.trim() : def.query;
}

/** Instruction for a run: the saved instruction plus the user's specific ask. */
export function runInstruction(def: CustomAgent, task: string): string {
  const t = task.trim();
  return t ? `${def.instruction}\n\nUser request: ${t}` : def.instruction;
}

export class SavedAgent implements Agent {
  readonly name: string;
  constructor(private readonly def: CustomAgent) {
    this.name = `saved:${def.name}`;
  }

  async run(task: string, ctx: AgentContext): Promise<AgentResult> {
    ctx.onStatus?.('thinking');
    const { text, sources } = await ctx.brain.draft(
      runQuery(this.def, task),
      runInstruction(this.def, task),
      ctx.scopes,
    );
    return { output: withSources(text, sources), steps: [] };
  }
}
