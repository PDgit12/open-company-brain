/**
 * Response cache for DETERMINISTIC saved-agent runs.
 *
 * Only deterministic generations are cacheable: a saved agent answering the same
 * request, over the same scopes, with NO conversation memory in the prompt. A
 * memory-carrying chat turn embeds prior dialogue, so its prompt is unique and
 * its hit-rate would be ~0 — we never cache those (the SavedAgent adapter gates
 * on prior turns, this layer just stores/fetches by key).
 *
 * Key = sha256(model + scopes + query + instruction). Entries expire after a TTL
 * so a changed brain doesn't serve stale answers forever. File-backed by default
 * (zero setup, survives across runs); in-memory variant for isolated tests.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { JsonFileCollection } from '../storage/json-file.js';

export function cacheKey(parts: {
  model: string;
  scopes: string[];
  query: string;
  instruction: string;
}): string {
  const canonical = JSON.stringify({
    model: parts.model,
    scopes: [...parts.scopes].sort(),
    query: parts.query,
    instruction: parts.instruction,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface ResponseCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

const fresh = (at: string, ttlSeconds: number): boolean =>
  ttlSeconds <= 0 ? false : Date.now() - new Date(at).getTime() < ttlSeconds * 1000;

export class InMemoryResponseCache implements ResponseCache {
  private store = new Map<string, { value: string; at: string }>();
  constructor(private readonly ttlSeconds: number) {}
  async get(key: string): Promise<string | undefined> {
    const hit = this.store.get(key);
    if (hit && fresh(hit.at, this.ttlSeconds)) return hit.value;
    if (hit) this.store.delete(key);
    return undefined;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, { value, at: new Date().toISOString() });
  }
}

interface CacheEntry {
  key: string;
  value: string;
  at: string;
}

export class FileResponseCache implements ResponseCache {
  private readonly collection: JsonFileCollection<CacheEntry>;
  constructor(dataDir: string, private readonly ttlSeconds: number) {
    this.collection = new JsonFileCollection<CacheEntry>(path.join(dataDir, 'response-cache.json'));
  }
  async get(key: string): Promise<string | undefined> {
    const hit = (await this.collection.read()).find((e) => e.key === key);
    return hit && fresh(hit.at, this.ttlSeconds) ? hit.value : undefined;
  }
  async set(key: string, value: string): Promise<void> {
    // Rewrite dropping this key's old entry and any expired entries — keeps the
    // file bounded and prevents serving a stale value after a TTL change.
    const kept = (await this.collection.read()).filter(
      (e) => e.key !== key && fresh(e.at, this.ttlSeconds),
    );
    kept.push({ key, value, at: new Date().toISOString() });
    await this.collection.write(kept);
  }
}

let singleton: ResponseCache | null = null;
export function getResponseCache(dataDir: string, ttlSeconds: number): ResponseCache {
  if (!singleton) singleton = new FileResponseCache(dataDir, ttlSeconds);
  return singleton;
}
