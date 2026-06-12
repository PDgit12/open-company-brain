/**
 * Refinery CLEAN stage — between NORMALIZE and EMBED.
 *
 * Real corpora arrive dirty: duplicated pastes, boilerplate whitespace,
 * control characters. Dirty data costs three times: embedding spend, retrieval
 * slots wasted on duplicates (a duplicate can crowd the topK and starve a
 * relevant chunk), and conflicting near-copies confusing composition. Cleaning
 * is deterministic code — exactly where the architecture wants it.
 */

import { META_ACCESS } from '../constants.js';
import type { MemoryDocument } from './documents.js';

/** Normalize text: strip control chars, collapse runs of blank lines/spaces. */
export function cleanText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // control chars
    .replace(/[ \t]+\n/g, '\n') // trailing whitespace
    .replace(/\n{3,}/g, '\n\n') // blank-line runs
    .replace(/[ \t]{2,}/g, ' ') // space runs
    .trim();
}

/** FNV-1a content hash for exact-duplicate detection (post-clean). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Clean every document and drop exact duplicates (same cleaned text + same
 * access scope — identical text in DIFFERENT scopes is legitimately two docs).
 * First occurrence wins; empties are dropped.
 */
export function cleanDocuments(docs: MemoryDocument[]): MemoryDocument[] {
  const seen = new Set<string>();
  const out: MemoryDocument[] = [];
  for (const d of docs) {
    const text = cleanText(d.text);
    if (!text) continue;
    const key = `${d.metadata[META_ACCESS] ?? ''}:${hash(text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...d, text });
  }
  return out;
}
