/**
 * The Brain service — the orchestration layer the API and CLI call.
 *
 * It wires together the universal pieces:
 *   data-in (ingest) → recall (memory) → generation, with a feedback loop.
 *
 * The brain is domain-agnostic. It boots EMPTY and is fed entirely through
 * `ingest` — a person pasting in the dashboard, an upload, or a workflow (n8n,
 * Zapier, cron) POSTing to the ingest webhook. Whatever the data, agents ground
 * every answer on it and cite their sources, or refuse.
 *
 * Public agents:
 *   • ask(question)            — grounded Q&A over the whole brain.
 *   • draft(query, instruction)— generic grounded generation (the no-code agent
 *                                seam + the action layer reuse this).
 *   • health()                 — what needs attention across recent knowledge.
 *
 * All are access-scoped: a caller only ever sees chunks their scopes allow.
 */

import { config } from '../config.js';
import { createMemoryStore, type MemoryStore, type RetrievedChunk, type SourceCount } from './memory.js';
import { createGenerator, type Generator } from '../agents/generator.js';
import { buildDocuments, normalizeSource, type IngestFormat } from './ingest.js';
import { runReactions, type FanoutResult } from '../fanout/engine.js';
import { demoDocuments } from '../seed/seed-data.js';
import { candidateCasesFromFeedback, type GoldenCase } from '../eval/golden.js';
import {
  getFeedbackStore,
  rerankByReward,
  type FeedbackStore,
  type Verdict,
} from '../feedback/feedback.js';
import {
  buildContextBlock,
  buildAskPrompt,
  buildHealthPrompt,
} from '../agents/prompts.js';

export interface BrainAnswer {
  answer: string;
  /** The records that grounded the answer — for the "show your sources" UI. */
  sources: RetrievedChunk[];
}

export class Brain {
  private constructor(
    private readonly memory: MemoryStore,
    private readonly generator: Generator,
    private readonly feedback: FeedbackStore,
  ) {}

  /** Record a user's verdict on an answer (fuel for the learning loops). */
  async recordAnswerFeedback(
    query: string,
    answer: string,
    verdict: Verdict,
    scopes: string[],
    sources: string[] = [],
  ): Promise<void> {
    await this.feedback.record({ kind: 'answer', query, answer, verdict, scopes, sources });
  }

  /**
   * Re-rank retrieved chunks by accumulated source reward (scope-gated).
   * No-op when no feedback exists, so behaviour is identical on a cold brain.
   */
  private async rerank(
    chunks: RetrievedChunk[],
    scopes: string[],
  ): Promise<RetrievedChunk[]> {
    const rewards = await this.feedback.sourceRewards(scopes);
    return rewards.size ? rerankByReward(chunks, rewards) : chunks;
  }

  /**
   * Build the brain. It starts EMPTY — there is no domain snapshot to load. On
   * the ephemeral mock backend we seed a few generic demo notes so the console
   * isn't blank; persistent backends (Langbase, pgvector) are populated by
   * ingestion (dashboard / webhook / `npm run setup:*`), so we never re-embed on
   * boot.
   */
  static async create(): Promise<Brain> {
    const memory = createMemoryStore();
    if (config.backend === 'mock') {
      await memory.upsert(demoDocuments());
    }
    return new Brain(memory, createGenerator(), getFeedbackStore());
  }

  async ask(question: string, accessScopes: string[]): Promise<BrainAnswer> {
    const retrieved = await this.memory.retrieve({ query: question, accessScopes, topK: 8 });
    // Reranking loop: boost sources humans found useful, demote rejected ones.
    const chunks = await this.rerank(retrieved, accessScopes);
    const context = buildContextBlock(chunks);
    // Few-shot learning loop: inject approved past answers (scope-gated) as
    // exemplars so the brain's style/rigor compounds with usage.
    const examples = await this.feedback.approvedExamples(question, accessScopes, 2);
    const prompt = buildAskPrompt(question, context, examples);
    const answer = await this.generator.generate({ prompt, chunks });
    return { answer, sources: chunks };
  }

  /**
   * Generic grounded draft: retrieve for `query`, then generate using a custom
   * `instruction`. The no-code custom agents, the fan-out reaction agents, and
   * the action layer all reuse this — same recall + generation + trust contract.
   */
  async draft(
    query: string,
    instruction: string,
    accessScopes: string[],
  ): Promise<{ text: string; sources: RetrievedChunk[] }> {
    const chunks = await this.memory.retrieve({ query, accessScopes, topK: 8 });
    const context = buildContextBlock(chunks);
    const text = await this.generator.generate({
      prompt: `${instruction}\n\nCONTEXT:\n${context}`,
      chunks,
    });
    return { text, sources: chunks };
  }

  /** Attention agent: what needs follow-up across the brain's recent knowledge. */
  async health(accessScopes: string[]): Promise<BrainAnswer> {
    const retrieved = await this.memory.retrieve({
      query: 'open action items follow ups deadlines risks unresolved questions next steps pending tasks attention overdue',
      accessScopes,
      topK: 12,
    });
    const chunks = await this.rerank(retrieved, accessScopes);
    const prompt = buildHealthPrompt(buildContextBlock(chunks));
    const answer = await this.generator.generate({ prompt, chunks });
    return { answer, sources: chunks };
  }

  /**
   * Ingest text/CSV/JSON into the recall layer so agents can ground answers on
   * it immediately. The write scope is forced to one the caller actually holds —
   * ingestion can never create data in a scope you can't read. This is the
   * universal data-in path the dashboard, uploads, and the workflow webhook share.
   */
  async ingest(
    input: { format: IngestFormat; content: string; source?: string; scope?: string },
    callerScopes: string[],
  ): Promise<{ ingested: number; source: string; scope: string; reactions: FanoutResult[] }> {
    const access =
      input.scope && callerScopes.includes(input.scope)
        ? input.scope
        : (callerScopes[0] ?? config.demoUserAccessScope);
    const source = normalizeSource(input.source ?? 'notes');
    const docs = buildDocuments({ format: input.format, content: input.content, source, access });
    const ingested = docs.length ? await this.memory.upsert(docs) : 0;
    // Fan-out: configured reaction agents run automatically over the new data
    // (no-op + zero generations when none are configured). Both the library
    // caller and the HTTP route reach fan-out through this one seam.
    const reactions = ingested
      ? await runReactions(this, { source, scope: access, query: input.content.slice(0, 500) })
      : [];
    return { ingested, source, scope: access, reactions };
  }

  /** Real per-source document counts the caller can see — for honest viz. */
  async knowledgeStats(scopes: string[]): Promise<SourceCount[]> {
    return this.memory.stats(scopes);
  }

  /**
   * Auto-grown eval candidates derived from rejected feedback (scope-gated).
   * A human-review queue for promotion into the curated golden set, not a CI gate.
   */
  async evalCandidates(scopes: string[]): Promise<GoldenCase[]> {
    return candidateCasesFromFeedback(await this.feedback.all(), scopes);
  }
}
