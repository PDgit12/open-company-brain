/**
 * The recall layer — the brain's semantic memory.
 *
 * `MemoryStore` is the interface the rest of the brain depends on. Five impls,
 * one seam — the factory (`createMemoryStore`) picks by config:
 *
 *   • FileKeywordMemoryStore — MODEL-FREE DEFAULT: keyword overlap over scoped
 *     chunks, persisted to .comb/. No embedder, no model, $0/query (ARCHITECTURE
 *     §9). The host agent brings the intelligence; Comb finds the right chunks.
 *   • MockMemoryStore — the in-memory rung of the persistence ladder (§4): same
 *     keyword-overlap scoring, but documents live in an array. Zero-credential
 *     and deterministic — what tests and the `mock` backend use. No file I/O.
 *   • FileVectorMemoryStore / PgVectorMemoryStore — OPT-IN semantic upgrade for
 *     deployments that accept an embedder (local Ollama → file or pgvector).
 *   • LangbaseMemoryStore — OPT-IN managed RAG via the Langbase SDK (lazy-loaded
 *     so the model-free default never pulls the generation tree into module load).
 *
 * CRITICAL SEAM: every impl filters on META_ACCESS using the exact key written by
 * the templating layer. Access control is only as real as this agreement.
 */

import path from 'node:path';
import type { Langbase } from 'langbase';
import pg from 'pg';
import { config } from '../config.js';
import { META_ACCESS, META_SOURCE } from '../constants.js';
import { createEmbedder, cosineSim, type Embedder } from './embedding.js';
import { JsonFileCollection } from '../storage/json-file.js';
import type { MemoryDocument } from './documents.js';

export interface RetrievedChunk {
  text: string;
  source: string;
  metadata: Record<string, string>;
  /** 0..1 relevance. */
  score: number;
}

export interface RetrieveOptions {
  query: string;
  /** Only return chunks whose access scope is in this set. */
  accessScopes: string[];
  topK?: number;
}

/** A real count of stored documents per provenance source (scope-filtered). */
export interface SourceCount {
  source: string;
  count: number;
}

export interface MemoryStore {
  /** Idempotent upsert of the full document set into the brain. */
  upsert(docs: MemoryDocument[]): Promise<number>;
  /** Semantic retrieval, filtered by access. */
  retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]>;
  /** Real per-source document counts the caller can see — powers honest viz. */
  stats(accessScopes: string[]): Promise<SourceCount[]>;
}

/**
 * WRITE-BOUNDARY GUARD: every stored document MUST carry a non-empty access
 * scope. An untagged doc isn't a leak (readers fail closed) — it's worse in a
 * quieter way: permanently invisible knowledge that no query can ever surface.
 * The ingest path always stamps a scope; this guard catches every OTHER writer
 * (seed scripts, connectors, direct library use) loudly at the boundary.
 * Shared by all store impls so the rule is defined exactly once.
 */
export function assertScoped(docs: MemoryDocument[]): void {
  for (const d of docs) {
    const access = d.metadata[META_ACCESS];
    if (!access || !access.trim()) {
      throw new Error(
        `Refusing to store document "${d.id}" without an access scope (${META_ACCESS}). ` +
          `Unscoped knowledge is unreachable by every reader — tag it or drop it.`,
      );
    }
  }
}

// ─── Mock implementation ─────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'about', 'is', 'are', 'what', 'who', 'our', 'we', 'me', 'prep', 'tell',
]);

/**
 * Light, symmetric suffix stemmer — collapse the common inflections so the
 * keyword retriever matches "refunds"→"refund" and "approving"→"approv" instead
 * of refusing a question it has the answer to. Applied identically to query and
 * document tokens (symmetry is what makes the match work), and only to tokens
 * long enough that stripping leaves a real stem (>4 chars). Deliberately NOT a
 * full Porter stemmer: this handles plurals/verb tenses (the over-refusal that
 * actually bites), stays O(token length), and leaves semantics (verb→noun, e.g.
 * "approve"→"approval") to the vector upgrade. Order matters: longest suffix first.
 */
function stem(t: string): string {
  if (t.length <= 4) return t;
  for (const suf of ['ing', 'ies', 'es', 'ed', 's']) {
    if (t.endsWith(suf) && t.length - suf.length >= 3) {
      // "ies" → "y" (policies→policy); other suffixes just drop.
      return suf === 'ies' ? `${t.slice(0, -3)}y` : t.slice(0, -suf.length);
    }
  }
  return t;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export class MockMemoryStore implements MemoryStore {
  private docs: MemoryDocument[] = [];

  async upsert(docs: MemoryDocument[]): Promise<number> {
    assertScoped(docs);
    const byId = new Map(this.docs.map((d) => [d.id, d]));
    for (const d of docs) byId.set(d.id, d);
    this.docs = [...byId.values()];
    return docs.length;
  }

  async retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
    const allowed = new Set(opts.accessScopes);
    const queryTokens = new Set(tokenize(opts.query));
    const topK = opts.topK ?? 8;

    const scored = this.docs
      .filter((d) => allowed.has(d.metadata[META_ACCESS] ?? ''))
      .map((d) => {
        const docTokens = tokenize(d.text);
        const hits = docTokens.filter((t) => queryTokens.has(t)).length;
        const score = queryTokens.size ? hits / queryTokens.size : 0;
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored.map(({ d, score }) => ({
      text: d.text,
      source: d.metadata[META_SOURCE] ?? 'unknown',
      metadata: d.metadata,
      score: Math.min(1, score),
    }));
  }

  async stats(accessScopes: string[]): Promise<SourceCount[]> {
    const allowed = new Set(accessScopes);
    const counts = new Map<string, number>();
    for (const d of this.docs) {
      if (!allowed.has(d.metadata[META_ACCESS] ?? '')) continue;
      const src = d.metadata[META_SOURCE] ?? 'unknown';
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
    return [...counts]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }
}

// ─── Langbase (live) implementation ──────────────────────────────────────────

/**
 * NOTE ON SDK SURFACE: Langbase evolves its SDK. The method names below follow
 * the documented Memory API (memories.create / documents.upload / retrieve).
 * Because this whole file is the only place that touches the SDK, if a method
 * name differs in your installed version you fix it here and nowhere else.
 */
export class LangbaseMemoryStore implements MemoryStore {
  private readonly apiKey: string;
  private readonly memoryName: string;
  private lb: Langbase | undefined;
  private ensured = false;

  constructor(apiKey: string, memoryName: string) {
    this.apiKey = apiKey;
    this.memoryName = memoryName;
  }

  /**
   * Lazily construct the SDK on first use. The `langbase` package drags in the
   * legacy OpenAI/node-fetch tree — keeping it out of module load means the
   * model-free default path (FileKeywordMemoryStore) never pulls it in. This is
   * the dependency-graph expression of the locked posture: the default runs no
   * model. Only a deployment that actually selects the langbase backend pays.
   */
  private async client(): Promise<Langbase> {
    if (!this.lb) {
      const { Langbase } = await import('langbase');
      this.lb = new Langbase({ apiKey: this.apiKey });
    }
    return this.lb;
  }

  private async ensureMemory(): Promise<void> {
    if (this.ensured) return;
    const lb = await this.client();
    try {
      await lb.memories.create({
        name: this.memoryName,
        description: 'Comb — semantic recall layer',
        embedding_model: config.langbase.embeddingModel,
      });
    } catch {
      // Already exists — that's fine; create is the only idempotency we need.
    }
    this.ensured = true;
  }

  async upsert(docs: MemoryDocument[]): Promise<number> {
    assertScoped(docs);
    await this.ensureMemory();
    const lb = await this.client();
    for (const d of docs) {
      // Langbase requires a valid filename with an allowed extension. Our ids
      // look like "company:1"; turn them into "company-1.txt".
      const documentName = `${d.id.replace(/[^a-z0-9_-]+/gi, '-')}.txt`;
      await lb.memories.documents.upload({
        memoryName: this.memoryName,
        documentName,
        contentType: 'text/plain',
        document: Buffer.from(d.text, 'utf8'),
        meta: d.metadata,
      });
    }
    return docs.length;
  }

  async retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
    await this.ensureMemory();
    const lb = await this.client();
    const results = await lb.memories.retrieve({
      memory: [{ name: this.memoryName }],
      query: opts.query,
      topK: opts.topK ?? 8,
    });

    return (results ?? [])
      .map((r): RetrievedChunk => {
        const metadata = (r.meta ?? {}) as Record<string, string>;
        return {
          text: r.text ?? '',
          source: metadata[META_SOURCE] ?? 'unknown',
          metadata,
          score: typeof r.similarity === 'number' ? r.similarity : 0,
        };
      })
      // Enforce access AFTER retrieval as a hard backstop, using the seam key.
      .filter((c) => opts.accessScopes.includes(c.metadata[META_ACCESS] ?? ''));
  }

  // Langbase Memory has no documented count/aggregate API, so per-source stats
  // are not available here. The dashboard treats an empty result as "unknown"
  // rather than showing a fabricated number. (Local/mock report real counts.)
  async stats(_accessScopes: string[]): Promise<SourceCount[]> {
    return [];
  }
}

// ─── Local (pgvector + Ollama embeddings) implementation ─────────────────────

/**
 * Fully-local recall: embeddings come from a local Embedder (Ollama) and vectors
 * live in Postgres + pgvector. $0 per query, self-hosted. Access control is the
 * same seam as every other store: the META_ACCESS scope is a column, filtered in
 * SQL so out-of-scope chunks never leave the database.
 */
export class PgVectorMemoryStore implements MemoryStore {
  private readonly pool: pg.Pool;
  private ready = false;

  constructor(
    connectionString: string,
    private readonly embedder: Embedder = createEmbedder(),
    private readonly minScore: number = config.ollama.minScore,
    private readonly table = 'brain_chunks',
  ) {
    this.pool = new pg.Pool({ connectionString });
  }

  private vec(v: number[]): string {
    return `[${v.join(',')}]`;
  }

  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         text text NOT NULL,
         source text,
         access text,
         metadata jsonb NOT NULL DEFAULT '{}',
         embedding vector(${this.embedder.dim})
       )`,
    );
    this.ready = true;
  }

  async upsert(docs: MemoryDocument[]): Promise<number> {
    assertScoped(docs);
    await this.ensure();
    if (!docs.length) return 0;
    const vectors = await this.embedder.embed(docs.map((d) => d.text));
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i]!;
      await this.pool.query(
        `INSERT INTO ${this.table} (id, text, source, access, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)
         ON CONFLICT (id) DO UPDATE
           SET text = EXCLUDED.text, source = EXCLUDED.source, access = EXCLUDED.access,
               metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding`,
        [d.id, d.text, d.metadata[META_SOURCE] ?? null, d.metadata[META_ACCESS] ?? null, d.metadata, this.vec(vectors[i]!)],
      );
    }
    return docs.length;
  }

  async retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
    await this.ensure();
    const [queryVec] = await this.embedder.embed([opts.query]);
    const { rows } = await this.pool.query(
      `SELECT text, source, metadata, 1 - (embedding <=> $1::vector) AS score
         FROM ${this.table}
        WHERE access = ANY($2::text[])
          AND (1 - (embedding <=> $1::vector)) >= $4
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [this.vec(queryVec!), opts.accessScopes, opts.topK ?? 8, this.minScore],
    );
    return rows.map((r: { text: string; source: string | null; metadata: Record<string, string>; score: number }) => ({
      text: r.text,
      source: r.source ?? 'unknown',
      metadata: r.metadata,
      score: Math.max(0, Math.min(1, Number(r.score))),
    }));
  }

  async stats(accessScopes: string[]): Promise<SourceCount[]> {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT COALESCE(source, 'unknown') AS source, count(*)::int AS count
         FROM ${this.table}
        WHERE access = ANY($1::text[])
        GROUP BY source
        ORDER BY count DESC`,
      [accessScopes],
    );
    return rows.map((r: { source: string; count: number }) => ({
      source: r.source,
      count: Number(r.count),
    }));
  }
}

/**
 * File-backed vector recall — the ZERO-DATABASE persistent brain.
 *
 * The missing zero-setup tier for KNOWLEDGE: embeddings + text + scope live in
 * one JSON file under the data dir; retrieval embeds the query and ranks by
 * cosine in-process. Real embeddings (Ollama or a key) → real semantic recall,
 * with NO Postgres and NO Docker — a user who installed only Ollama gets a
 * working, persistent brain. Same scope-filter + min-score + assertScoped
 * contract as pgvector, so the grounding gate and calibration behave identically.
 * Brute-force search is fine to ~10k chunks; past that, move to pgvector/S3.
 */
export class FileVectorMemoryStore implements MemoryStore {
  private readonly collection: JsonFileCollection<MemoryDocument & { embedding: number[] }>;
  constructor(
    dataDir: string,
    private readonly embedder: Embedder = createEmbedder(),
    private readonly minScore: number = config.ollama.minScore,
  ) {
    this.collection = new JsonFileCollection<MemoryDocument & { embedding: number[] }>(
      path.join(dataDir, 'vectors.json'),
    );
  }

  async upsert(docs: MemoryDocument[]): Promise<number> {
    assertScoped(docs);
    if (!docs.length) return 0;
    const vectors = await this.embedder.embed(docs.map((d) => d.text));
    const existing = await this.collection.read();
    const byId = new Map(existing.map((d) => [d.id, d]));
    docs.forEach((d, i) => byId.set(d.id, { ...d, embedding: vectors[i]! }));
    await this.collection.write([...byId.values()]);
    return docs.length;
  }

  async retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
    const allowed = new Set(opts.accessScopes);
    const rows = (await this.collection.read()).filter((d) => allowed.has(d.metadata[META_ACCESS] ?? ''));
    if (!rows.length) return [];
    const [q] = await this.embedder.embed([opts.query]);
    return rows
      .map((d) => ({
        text: d.text,
        source: d.metadata[META_SOURCE] ?? 'unknown',
        metadata: d.metadata,
        score: Math.max(0, Math.min(1, cosineSim(q!, d.embedding))),
      }))
      .filter((c) => c.score >= this.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK ?? 8);
  }

  async stats(accessScopes: string[]): Promise<SourceCount[]> {
    const allowed = new Set(accessScopes);
    const counts = new Map<string, number>();
    for (const d of await this.collection.read()) {
      if (!allowed.has(d.metadata[META_ACCESS] ?? '')) continue;
      const src = d.metadata[META_SOURCE] ?? 'unknown';
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
    return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
  }
}

/**
 * Model-free, persistent KEYWORD recall — the MCP-first / no-model store.
 * Same overlap scoring as MockMemoryStore (needs NO embedder), but file-
 * persistent so a brain survives across processes with zero models and zero
 * database. The host agent does the smart synthesis over what this returns;
 * this just finds the right governed, scoped chunks by term overlap. Same
 * scope-filter + assertScoped contract as every store.
 */
export class FileKeywordMemoryStore implements MemoryStore {
  private readonly collection: JsonFileCollection<MemoryDocument>;
  constructor(dataDir: string) {
    this.collection = new JsonFileCollection<MemoryDocument>(path.join(dataDir, 'keyword-docs.json'));
  }
  async upsert(docs: MemoryDocument[]): Promise<number> {
    assertScoped(docs);
    const byId = new Map((await this.collection.read()).map((d) => [d.id, d]));
    for (const d of docs) byId.set(d.id, d);
    await this.collection.write([...byId.values()]);
    return docs.length;
  }
  async retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
    const allowed = new Set(opts.accessScopes);
    const q = new Set(tokenize(opts.query));
    return (await this.collection.read())
      .filter((d) => allowed.has(d.metadata[META_ACCESS] ?? ''))
      .map((d) => {
        const hits = tokenize(d.text).filter((t) => q.has(t)).length;
        return { d, score: q.size ? hits / q.size : 0 };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK ?? 8)
      .map(({ d, score }) => ({ text: d.text, source: d.metadata[META_SOURCE] ?? 'unknown', metadata: d.metadata, score: Math.min(1, score) }));
  }
  async stats(accessScopes: string[]): Promise<SourceCount[]> {
    const allowed = new Set(accessScopes);
    const counts = new Map<string, number>();
    for (const d of await this.collection.read()) {
      if (!allowed.has(d.metadata[META_ACCESS] ?? '')) continue;
      const src = d.metadata[META_SOURCE] ?? 'unknown';
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
    return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
  }
}

export function createMemoryStore(opts: { minScoreOverride?: number } = {}): MemoryStore {
  // MODEL-FREE posture (explicit): keyword recall, no embedder, file-persistent,
  // regardless of backend. This is the MCP-first no-model product mode.
  if (config.comb.retrieval === 'keyword') {
    return new FileKeywordMemoryStore(config.comb.dataDir);
  }
  // Live backends (local Ollama / BYO key): pgvector when a Postgres URL is
  // configured (scale), else the FILE-BACKED vector store — a persistent brain
  // with NO database, so `npm i -g` + Ollama just works. Same contract either way.
  if (config.backend === 'openai' || config.backend === 'local') {
    const score = opts.minScoreOverride ?? config.ollama.minScore;
    return config.ollama.vectorDatabaseUrl
      ? new PgVectorMemoryStore(config.ollama.vectorDatabaseUrl, undefined, score)
      : new FileVectorMemoryStore(config.comb.dataDir, undefined, score);
  }
  if (config.backend === 'langbase' && config.langbase.apiKey) {
    return new LangbaseMemoryStore(config.langbase.apiKey, config.langbase.memoryName);
  }
  return new MockMemoryStore();
}

