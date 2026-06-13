/**
 * CCR serving optimizer (knitbrain's lesson) — make every served token count.
 *
 * Comb serves DATA to a host model over MCP. The host pays for every token it
 * receives. Three optimizations, all model-free and lossless-by-default:
 *
 *   1. DEDUP via a per-session RETRIEVAL MANIFEST — never re-send a chunk the
 *      host already received this session; emit a one-line reference instead.
 *   2. COMPRESS — collapse whitespace; bound each item to a token ceiling.
 *   3. CACHE-ALIGN — stable, sorted ordering so the host's prompt cache hits.
 *
 * THE RULE (knitbrain's): the optimizer must NEVER make a payload larger. If
 * the optimized text isn't smaller, the original passes through unchanged.
 *
 * The manifest is per session (an MCP connection / principal); file-backed so
 * it survives across tool calls within a session.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { JsonFileCollection } from '../storage/json-file.js';
import { estimateTokens } from '../harness/tokens.js';

export interface ServeItem {
  text: string;
  source: string;
}

export interface ServeResult {
  /** The optimized payload to return to the host. */
  text: string;
  /** How many items were full vs deduped to a reference. */
  full: number;
  deduped: number;
  tokensBefore: number;
  tokensAfter: number;
}

interface ManifestEntry {
  hash: string;
  at: string;
}

const hash = (s: string): string => createHash('sha256').update(s.trim()).digest('hex').slice(0, 16);

/** Collapse whitespace and bound to a token ceiling (lossless until the cap). */
function compress(text: string, maxTokens: number): string {
  const collapsed = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (estimateTokens(collapsed) <= maxTokens) return collapsed;
  // chop to ~maxTokens (chars/4 heuristic boundary), mark the truncation
  return collapsed.slice(0, maxTokens * 4) + ' …[truncated]';
}

export class ServingOptimizer {
  private readonly manifest: JsonFileCollection<ManifestEntry>;
  constructor(sessionKey: string, dataDir = config.comb.dataDir) {
    const safe = sessionKey.replace(/[^a-z0-9_-]/gi, '_') || 'default';
    this.manifest = new JsonFileCollection<ManifestEntry>(path.join(dataDir, 'ccr', `${safe}.json`));
  }

  /**
   * Optimize a set of retrieved items for serving. Items already served this
   * session become a compact reference (dedup); the rest are compressed and
   * cache-aligned (sorted by source). Never returns more tokens than the raw.
   */
  async serve(items: ServeItem[], maxItemTokens = 400): Promise<ServeResult> {
    const raw = items.map((i) => `[${i.source}] ${i.text}`).join('\n\n');
    const tokensBefore = estimateTokens(raw);
    const seen = new Set((await this.manifest.read()).map((m) => m.hash));

    // CACHE-ALIGN: stable order so repeated calls share a prompt-cache prefix.
    const ordered = [...items].sort((a, b) => (a.source + a.text).localeCompare(b.source + b.text));

    let full = 0;
    let deduped = 0;
    const parts: string[] = [];
    const toRecord: ManifestEntry[] = [];
    for (const it of ordered) {
      const h = hash(it.text);
      if (seen.has(h)) {
        deduped++;
        parts.push(`[${it.source}] (already provided this session)`);
      } else {
        full++;
        parts.push(`[${it.source}] ${compress(it.text, maxItemTokens)}`);
        toRecord.push({ hash: h, at: new Date().toISOString() });
        seen.add(h);
      }
    }
    await this.manifest.appendMany(toRecord); // ONE write, not k writes (was O(n²))

    const optimized = parts.join('\n\n');
    const tokensAfter = estimateTokens(optimized);
    // THE RULE: never larger than the raw.
    if (tokensAfter >= tokensBefore) {
      return { text: raw, full: items.length, deduped: 0, tokensBefore, tokensAfter: tokensBefore };
    }
    return { text: optimized, full, deduped, tokensBefore, tokensAfter };
  }
}
