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
import { createGenerator, OllamaGenerator, DRAFT_SYSTEM, type Generator } from '../agents/generator.js';
import { assessGrounding, resolveGroundingPolicy, type GroundingPolicy } from './grounding.js';
import { answered, refusal, type AnswerRecord } from './record.js';
import { generateStructured } from './structured.js';
import { buildDocuments, normalizeSource, type IngestFormat } from './ingest.js';
import { cleanDocuments } from './clean.js';
import { runReactions, type FanoutResult } from '../fanout/engine.js';
import { runDivergenceWatch, detectCandidates } from '../divergence/engine.js';
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
  /** The typed contract — downstream consumers read THIS, not the prose. */
  record: AnswerRecord;
}

/** Wire-compatible view of a record ({answer, sources} edges keep working). */
function toBrainAnswer(record: AnswerRecord): BrainAnswer {
  return { answer: record.answer, sources: record.citations, record };
}

export class Brain {
  private constructor(
    private readonly memory: MemoryStore,
    private generator: Generator,
    private readonly feedback: FeedbackStore,
    private readonly grounding: GroundingPolicy,
  ) {}

  /**
   * Hot-swap the generation model for THIS brain instance (local backend only —
   * model choice is an Ollama call parameter there; on Langbase it's pipe
   * config, and the mock has no model). Recall, scopes, memory, and the
   * grounding gate are untouched: only generation changes, so a `/model` switch
   * mid-conversation keeps every governance property intact.
   */
  setGenerationModel(model: string): boolean {
    if (config.backend !== 'local') return false;
    this.generator = new OllamaGenerator(config.ollama.baseUrl, model.trim());
    return true;
  }

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
    // Grounding policy is resolved once at boot: calibrated per-embedding-model
    // floor when `comb calibrate` has run, else the env floor + safety margin.
    return new Brain(memory, createGenerator(), getFeedbackStore(), await resolveGroundingPolicy());
  }

  /**
   * THE GROUNDING GATE — the harness decides refusal, not the model.
   * Vector search always returns nearest neighbours; a context assembled from
   * barely-relevant chunks reads plausible and produces a fluent, cited, wrong
   * answer. So before any generation we check the retrieval scores against the
   * calibrated floor and refuse deterministically when grounding is too thin —
   * the model never sees a context it shouldn't answer from. Refusals carry NO
   * sources: we don't cite what we refused to use.
   */
  private refuseUnlessGrounded(chunks: RetrievedChunk[]): RetrievedChunk[] | null {
    return assessGrounding(chunks, this.grounding).sufficient ? chunks : null;
  }

  /**
   * Pure scoped retrieval — no generation. The cheap path for callers that bring
   * their own model (e.g. an agentic IDE via the MCP `search_brain` tool): hand
   * back the governed, access-filtered, reranked chunks and let the host's agent
   * synthesize. Same access boundary as every other read.
   */
  async search(query: string, accessScopes: string[], topK = 8): Promise<RetrievedChunk[]> {
    const retrieved = await this.memory.retrieve({ query, accessScopes, topK });
    return this.rerank(retrieved, accessScopes);
  }

  async ask(question: string, accessScopes: string[]): Promise<BrainAnswer> {
    const retrieved = await this.memory.retrieve({ query: question, accessScopes, topK: 8 });
    // Reranking loop: boost sources humans found useful, demote rejected ones.
    const chunks = await this.rerank(retrieved, accessScopes);
    // Grounding gate: refuse in code before generation when retrieval is thin.
    if (!this.refuseUnlessGrounded(chunks)) {
      return toBrainAnswer(refusal());
    }
    const context = buildContextBlock(chunks);
    // Few-shot learning loop: inject approved past answers (scope-gated) as
    // exemplars so the brain's style/rigor compounds with usage.
    const examples = await this.feedback.approvedExamples(question, accessScopes, 2);
    const prompt = buildAskPrompt(question, context, examples);
    // Phase 2: constrained decoding — the model fills the record schema and
    // code validates it (status enum + citation subset proof). Falls back to
    // the legacy prose path when unsupported or twice-invalid.
    const structured = await generateStructured(question, chunks);
    if (structured) return toBrainAnswer(structured);
    const answer = await this.generator.generate({ prompt, chunks });
    return toBrainAnswer(answered(answer, chunks));
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
  ): Promise<{ text: string; sources: RetrievedChunk[]; record: AnswerRecord }> {
    const chunks = await this.memory.retrieve({ query, accessScopes, topK: 8 });
    // Same grounding gate as ask(): every no-code agent inherits it for free.
    if (!this.refuseUnlessGrounded(chunks)) {
      const r = refusal();
      return { text: r.answer, sources: [], record: r };
    }
    // NOTE: draft is GENERATION under an instruction (actions, fan-out, no-code
    // agents) — NOT question-answering. The SELECT/COMPOSE answerability
    // pipeline belongs only to ask(); applied here it wrongly judges a drafting
    // instruction ("Draft a notice…") as unanswerable and refuses grounded
    // data. So draft = grounding gate (above) + direct generation.
    const context = buildContextBlock(chunks);
    const prompt = `${instruction}\n\nCONTEXT:\n${context}`;
    // Draft = generation under an instruction → the DRAFTING system role, not
    // the cite-or-refuse Q&A role (which made small models refuse draftable data).
    const text = await this.generator.generate({ prompt, chunks, system: DRAFT_SYSTEM });
    const r = answered(text, chunks);
    return { text, sources: chunks, record: r };
  }

  /**
   * Conversational recall — answer from the DIALOGUE, not from company records.
   *
   * Used only as the saved-agent fallback when retrieval refused but grounded
   * conversation memory exists (e.g. "what did I just ask you?"). This is NOT a
   * grounding bypass: the only context the model sees is the conversation
   * itself (which contains exclusively grounded exchanges, per memory hygiene),
   * the caller marks the output as memory-derived, and it is never cited or
   * stored back — so a memory answer can't masquerade as knowledge or compound.
   */
  async converse(instruction: string, conversation: string): Promise<string> {
    const prompt =
      `${instruction}\n\n` +
      `CONTEXT (the conversation so far — dialogue history, NOT company records):\n${conversation}\n\n` +
      `Answer only from this conversation. If the answer isn't in it, say you don't know.`;
    // The conversation doubles as the mock generator's context chunk, keeping
    // this path deterministic and testable without credentials.
    return this.generator.generate({
      prompt,
      chunks: [{ text: conversation, source: 'conversation', metadata: {}, score: 1 }],
    });
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
    return toBrainAnswer(answered(answer, chunks));
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
  ): Promise<{ ingested: number; source: string; scope: string; reactions: FanoutResult[]; divergences: number; candidates: number }> {
    const access =
      input.scope && callerScopes.includes(input.scope)
        ? input.scope
        : (callerScopes[0] ?? config.demoUserAccessScope);
    const source = normalizeSource(input.source ?? 'notes');
    // Refinery CLEAN stage: strip boilerplate, drop exact duplicates (per
    // scope) BEFORE embedding — dirty data costs embed spend, wastes topK
    // retrieval slots, and feeds composition conflicting near-copies.
    const docs = cleanDocuments(buildDocuments({ format: input.format, content: input.content, source, access }));
    const ingested = docs.length ? await this.memory.upsert(docs) : 0;
    // Fan-out: configured reaction agents run automatically over the new data
    // (no-op + zero generations when none are configured). Both the library
    // caller and the HTTP route reach fan-out through this one seam.
    const reactions = ingested
      ? await runReactions(this, { source, scope: access, query: input.content.slice(0, 500) })
      : [];
    // THE LOOP'S COMPARE STAGE: new reality vs every enabled Intent in scope.
    // Flag-or-silent; a diverged flag lands in the approval queue. Best-effort.
    // MODEL-FREE candidate detection (always; pure keyword overlap, no model) —
    // surfaces what the host should judge via list_divergence_candidates.
    const candidates = ingested ? (await detectCandidates({ content: input.content, source, scope: access })).length : 0;
    // Model-based verdict path runs only when a model is configured (best-effort).
    const divergences = ingested && config.backend === 'local'
      ? (await runDivergenceWatch(this, { content: input.content, source, scope: access }))
          .filter((d) => d.status === 'diverged').length
      : 0;
    return { ingested, source, scope: access, reactions, divergences, candidates };
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
