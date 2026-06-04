/**
 * The recall layer — the brain's semantic memory.
 *
 * `MemoryStore` is the interface the rest of the brain depends on. Two impls:
 *
 *   • LangbaseMemoryStore — real managed RAG: documents are embedded and stored
 *     in Langbase Memory; retrieval is vector similarity + metadata filter.
 *
 *   • MockMemoryStore — zero-credential, deterministic: documents live in an
 *     array; retrieval is keyword overlap scoring + the SAME metadata filter.
 *     Good enough to show the end-to-end shape (and to test it) without a key.
 *
 * CRITICAL SEAM: both impls filter on META_ACCESS using the exact key written by
 * the templating layer. Access control is only as real as this agreement.
 */

import { Langbase } from 'langbase';
import pg from 'pg';
import { config } from '../config.js';
import { META_ACCESS, META_SOURCE } from '../constants.js';
import { createEmbedder, type Embedder } from './embedding.js';
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

// ─── Mock implementation ─────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
  'about', 'is', 'are', 'what', 'who', 'our', 'we', 'me', 'prep', 'tell',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export class MockMemoryStore implements MemoryStore {
  private docs: MemoryDocument[] = [];

  async upsert(docs: MemoryDocument[]): Promise<number> {
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
  private readonly lb: Langbase;
  private readonly memoryName: string;
  private ensured = false;

  constructor(apiKey: string, memoryName: string) {
    this.lb = new Langbase({ apiKey });
    this.memoryName = memoryName;
  }

  private async ensureMemory(): Promise<void> {
    if (this.ensured) return;
    try {
      await this.lb.memories.create({
        name: this.memoryName,
        description: 'Company Brain — semantic recall layer',
        embedding_model: config.langbase.embeddingModel,
      });
    } catch {
      // Already exists — that's fine; create is the only idempotency we need.
    }
    this.ensured = true;
  }

  async upsert(docs: MemoryDocument[]): Promise<number> {
    await this.ensureMemory();
    for (const d of docs) {
      // Langbase requires a valid filename with an allowed extension. Our ids
      // look like "company:1"; turn them into "company-1.txt".
      const documentName = `${d.id.replace(/[^a-z0-9_-]+/gi, '-')}.txt`;
      await this.lb.memories.documents.upload({
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
    const results = await this.lb.memories.retrieve({
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

export function createMemoryStore(): MemoryStore {
  if (config.backend === 'local') {
    if (!config.ollama.vectorDatabaseUrl) {
      throw new Error('Local backend needs a Postgres for pgvector — set VECTOR_DATABASE_URL (or DATABASE_URL).');
    }
    return new PgVectorMemoryStore(config.ollama.vectorDatabaseUrl);
  }
  if (config.backend === 'langbase' && config.langbase.apiKey) {
    return new LangbaseMemoryStore(config.langbase.apiKey, config.langbase.memoryName);
  }
  return new MockMemoryStore();
}
