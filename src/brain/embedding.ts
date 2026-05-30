/**
 * The embedding layer — turns text into vectors for the local (pgvector) recall
 * store. Like every other seam, it's an interface with swappable impls:
 *
 *   • OllamaEmbedder — local, $0/call: POSTs to a running Ollama server.
 *   • MockEmbedder   — deterministic, dependency-free: a hashed unit vector.
 *     Lets the vector math + store be unit-tested with no server.
 *
 * Generation and embeddings are independent — you can run local embeddings with
 * a hosted generator, or vice-versa. This file is the only place that talks to
 * an embedding provider.
 */

import { config } from '../config.js';

export interface Embedder {
  /** Embed a batch of texts into vectors (one per input, same order). */
  embed(texts: string[]): Promise<number[][]>;
  /** Vector dimension — the recall store needs it to declare its column. */
  readonly dim: number;
}

/** Cosine similarity in [-1, 1]. Pure; used by the in-memory fallback + tests. */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Deterministic hashed embedding — no model, no network. For tests + fallback. */
export class MockEmbedder implements Embedder {
  constructor(readonly dim: number = 64) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const token of text.toLowerCase().split(/\s+/).filter(Boolean)) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % this.dim;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

/** Local embeddings via a running Ollama server (e.g. nomic-embed-text). */
export class OllamaEmbedder implements Embedder {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    readonly dim: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embeddings failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as { embedding?: number[] };
      if (!json.embedding?.length) throw new Error('Ollama returned an empty embedding.');
      out.push(json.embedding);
    }
    return out;
  }
}

export function createEmbedder(): Embedder {
  if (config.backend === 'local') {
    return new OllamaEmbedder(
      config.ollama.baseUrl,
      config.ollama.embeddingModel,
      config.ollama.embeddingDim,
    );
  }
  return new MockEmbedder();
}
