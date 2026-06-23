/**
 * The feedback substrate — the fuel for every self-improvement loop.
 *
 * Every terminal signal (a user's thumbs up/down on an answer, an approved or
 * rejected action) becomes a FeedbackEvent. From this one canonical store, later
 * features read:
 *   • few-shot exemplars (approved answers)        — Phase 0
 *   • a retrieval reranker (per-chunk reward)       — Phase 3
 *   • auto-grown eval cases                         — Phase 3
 *
 * It is deliberately one small interface with an in-memory default so it works
 * in mock mode with zero setup. A Postgres-backed impl is a drop-in later.
 *
 * SCOPE SAFETY: exemplar retrieval is gated by access scope — an approved answer
 * from a privileged scope must never leak into a broader-scope prompt.
 */

export type Verdict = 'approved' | 'rejected' | 'helpful' | 'unhelpful';

export interface FeedbackEvent {
  id: string;
  at: string;
  /**
   * 'answer' (Q&A/brief feedback), 'action' (approve/reject of a write at
   * decision time), or 'outcome' (the measured real-world result AFTER a
   * delivered action — the Signal rung that closes the loop on reality, not
   * just on a human's yes).
   */
  kind: 'answer' | 'action' | 'outcome';
  query: string;
  answer: string;
  verdict: Verdict;
  scopes: string[];
  /** Normalized reward in [-1, 1]; see rewardFor(). */
  reward: number;
  /** Citation source ids that grounded the answer — fuel for the reranker. */
  sources?: string[];
}

export interface ApprovedExample {
  query: string;
  answer: string;
}

/** One composite reward currency shared by every loop. */
export function rewardFor(verdict: Verdict): number {
  switch (verdict) {
    case 'approved':
    case 'helpful':
      return 1;
    case 'rejected':
    case 'unhelpful':
      return -1;
  }
}

/**
 * Reorder retrieved chunks by relevance *nudged* by accumulated source reward.
 * Pure and deterministic: relevance dominates (the nudge is bounded via tanh and
 * scaled by `lambda`), so feedback only re-orders near-ties and demotes sources a
 * human has rejected. With no reward for a source, the chunk is unchanged.
 */
export function rerankByReward<T extends { source: string; score: number }>(
  chunks: T[],
  rewards: Map<string, number>,
  lambda = 0.25,
): T[] {
  return [...chunks]
    .map((c) => ({ c, adj: c.score * (1 + lambda * Math.tanh(rewards.get(c.source) ?? 0)) }))
    .sort((a, b) => b.adj - a.adj)
    .map((x) => x.c);
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'is', 'are', 'what', 'who', 'our', 'we']);
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t)),
  );
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / a.size;
}

let counter = 0;
const nextId = (): string => `fb_${++counter}_${process.pid}`;

export class InMemoryFeedbackStore {
  private events: FeedbackEvent[] = [];

  async record(
    e: Omit<FeedbackEvent, 'id' | 'at' | 'reward'> & { reward?: number },
  ): Promise<void> {
    this.events.push({
      ...e,
      id: nextId(),
      at: new Date().toISOString(),
      reward: e.reward ?? rewardFor(e.verdict),
    });
  }

  async approvedExamples(query: string, scopes: string[], k: number): Promise<ApprovedExample[]> {
    const allowed = new Set(scopes);
    const qt = tokens(query);
    return this.events
      // Only human Q&A answers are exemplars — never action payloads (raw JSON,
      // and often recorded with empty scopes, which would bypass the gate below).
      .filter((e) => e.kind === 'answer')
      .filter((e) => e.reward > 0 && e.answer.trim().length > 0)
      // SCOPE GATE: the example's scopes must all be visible to this caller, and
      // an unscoped example is not eligible (no empty-array bypass).
      .filter((e) => e.scopes.length > 0 && e.scopes.every((s) => allowed.has(s)))
      .map((e) => ({ e, score: overlap(qt, tokens(e.query)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((x) => ({ query: x.e.query, answer: x.e.answer }));
  }

  async sourceRewards(scopes: string[]): Promise<Map<string, number>> {
    const allowed = new Set(scopes);
    const out = new Map<string, number>();
    for (const e of this.events) {
      // Reward flows from Q&A verdicts AND real-world action OUTCOMES — both
      // carry the citation sources that grounded them, so a source whose draft
      // got a reply/conversion is boosted and one whose draft bounced is demoted.
      // Action approve/reject (kind 'action') is deliberately excluded: it's a
      // decision-time yes, not a measured result, and carries no sources.
      if ((e.kind !== 'answer' && e.kind !== 'outcome') || !e.sources?.length) continue;
      if (!(e.scopes.length > 0 && e.scopes.every((s) => allowed.has(s)))) continue;
      // Reward flows to every source the answer cited — positive boosts, negative demotes.
      for (const s of e.sources) out.set(s, (out.get(s) ?? 0) + e.reward);
    }
    return out;
  }

  async all(): Promise<FeedbackEvent[]> {
    return [...this.events];
  }
}

let singleton: InMemoryFeedbackStore | null = null;
/** Process-wide store so API requests and the action layer share one substrate. */
export function getFeedbackStore(): InMemoryFeedbackStore {
  if (!singleton) singleton = new InMemoryFeedbackStore();
  return singleton;
}
