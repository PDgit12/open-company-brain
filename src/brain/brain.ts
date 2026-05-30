/**
 * The Brain service — the orchestration layer the API and CLI call.
 *
 * It wires together the four pieces we designed:
 *   data source → recall (memory) + graph → generation
 *
 * Two public agents:
 *   • brief(companyName)  — a partner briefing (read-only, the v0 wedge).
 *   • ask(question)       — grounded Q&A over the whole brain.
 *
 * Both are access-scoped: a caller only ever sees chunks their scopes allow.
 */

import { createDataSource } from '../db/datasource.js';
import { createMemoryStore, type MemoryStore, type RetrievedChunk } from './memory.js';
import { createGenerator, type Generator } from '../agents/generator.js';
import { snapshotToDocuments } from './documents.js';
import { type Path } from '../graph/relationships.js';
import { createGraphBackend, type GraphBackend } from '../graph/backend.js';
import { candidateCasesFromFeedback, type GoldenCase } from '../eval/golden.js';
import {
  getFeedbackStore,
  rerankByReward,
  type FeedbackStore,
  type Verdict,
} from '../feedback/feedback.js';
import {
  buildContextBlock,
  buildBriefingPrompt,
  buildAskPrompt,
  buildHealthPrompt,
} from '../agents/prompts.js';
import type { BrainSnapshot } from '../domain/types.js';

export interface BrainAnswer {
  answer: string;
  /** The records that grounded the answer — for the "show your sources" UI. */
  sources: RetrievedChunk[];
  introPath?: Path | null;
}

export class Brain {
  private constructor(
    private readonly memory: MemoryStore,
    private readonly generator: Generator,
    private readonly snapshot: BrainSnapshot,
    private readonly graph: GraphBackend,
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

  /** Build the brain: load source-of-truth, sync it into recall, build the graph. */
  static async create(): Promise<Brain> {
    const dataSource = createDataSource();
    try {
      const snapshot = await dataSource.loadSnapshot();
      const memory = createMemoryStore();
      // Best-effort boot sync. If the recall layer can't be populated (e.g. a
      // live provider isn't configured yet), the brain still boots and simply
      // answers "I don't have that" until `npm run sync` succeeds — safe by
      // design (cite-or-refuse), never a hard crash.
      try {
        await memory.upsert(snapshotToDocuments(snapshot));
      } catch (err) {
        console.warn(
          `⚠ Boot sync skipped: ${(err as Error).message}. ` +
            `Run "npm run sync" once the recall provider is configured.`,
        );
      }
      const graph = createGraphBackend(snapshot);
      return new Brain(memory, createGenerator(), snapshot, graph, getFeedbackStore());
    } finally {
      await dataSource.close();
    }
  }

  private findCompanyId(name: string): string | undefined {
    const lower = name.toLowerCase();
    return this.snapshot.companies.find(
      (c) => c.name.toLowerCase() === lower || c.name.toLowerCase().includes(lower),
    )?.id;
  }

  async brief(companyName: string, accessScopes: string[]): Promise<BrainAnswer> {
    const retrieved = await this.memory.retrieve({
      query: `${companyName} partnership history recent engagements open actions contacts`,
      accessScopes,
      topK: 10,
    });
    const chunks = await this.rerank(retrieved, accessScopes);
    const context = buildContextBlock(chunks);
    const prompt = buildBriefingPrompt(companyName, context);
    const answer = await this.generator.generate({ prompt, chunks });
    return { answer, sources: chunks };
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
   * `instruction`. Used by the action layer and the health agent so they reuse
   * the same recall + generation (and the same trust contract) as brief/ask.
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

  /** Relationship-health agent: what needs attention across the brain. */
  async health(accessScopes: string[]): Promise<BrainAnswer> {
    const retrieved = await this.memory.retrieve({
      query: 'open actions follow up stale renewal overdue next steps engagements',
      accessScopes,
      topK: 12,
    });
    const chunks = await this.rerank(retrieved, accessScopes);
    const prompt = buildHealthPrompt(buildContextBlock(chunks));
    const answer = await this.generator.generate({ prompt, chunks });
    return { answer, sources: chunks };
  }

  /** Resolve a company name to its id (public for the action layer). */
  resolveCompanyId(name: string): string | null {
    return this.findCompanyId(name) ?? null;
  }

  /** Graph query exposed directly: warm-intro path between two companies. */
  async introPath(fromCompany: string, toCompany: string): Promise<Path | null> {
    const from = this.findCompanyId(fromCompany);
    const to = this.findCompanyId(toCompany);
    if (!from || !to) return null;
    return this.graph.introPath(from, to);
  }

  /** Names the brain knows about — handy for demo UIs and autocomplete. */
  companyNames(): string[] {
    return this.snapshot.companies.map((c) => c.name);
  }

  /**
   * Auto-grown eval candidates derived from rejected feedback (scope-gated).
   * A human-review queue for promotion into the curated golden set, not a CI gate.
   */
  async evalCandidates(scopes: string[]): Promise<GoldenCase[]> {
    return candidateCasesFromFeedback(await this.feedback.all(), scopes);
  }
}
