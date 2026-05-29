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
import { config } from '../config.js';
import { META_ACCESS } from '../constants.js';
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

export interface MemoryStore {
  /** Idempotent upsert of the full document set into the brain. */
  upsert(docs: MemoryDocument[]): Promise<number>;
  /** Semantic retrieval, filtered by access. */
  retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]>;
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
      source: d.metadata['source'] ?? 'unknown',
      metadata: d.metadata,
      score: Math.min(1, score),
    }));
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
          source: metadata['source'] ?? 'unknown',
          metadata,
          score: typeof r.similarity === 'number' ? r.similarity : 0,
        };
      })
      // Enforce access AFTER retrieval as a hard backstop, using the seam key.
      .filter((c) => opts.accessScopes.includes(c.metadata[META_ACCESS] ?? ''));
  }
}

export function createMemoryStore(): MemoryStore {
  if (config.memoryMode === 'live' && config.langbase.apiKey) {
    return new LangbaseMemoryStore(config.langbase.apiKey, config.langbase.memoryName);
  }
  return new MockMemoryStore();
}
