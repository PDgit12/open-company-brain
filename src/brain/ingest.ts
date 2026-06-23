/**
 * Ingestion — the universal data-in path: turn any text / CSV / JSON into
 * embeddable memory documents.
 *
 * This backs every way data enters the brain — a person pasting in the
 * dashboard, an upload, or a workflow (n8n, Zapier, cron) POSTing to the ingest
 * webhook. Whatever the shape, it becomes scoped, cited, retrievable knowledge.
 * There is no privileged schema. The functions here are PURE (no I/O);
 * `Brain.ingest` embeds + upserts and triggers the fan-out agents.
 *
 * Provenance + access live in metadata using the SAME seam keys (constants.ts)
 * every reader uses, so a hand-pasted note is filtered, cited, and
 * access-controlled identically to a record pushed in by a workflow.
 *
 * SECURITY: the caller-validated `access` scope is forced onto every emitted
 * document, so ingestion can never write data into a scope the caller does not
 * hold. Scope validation happens at the seam (the API route / API key), and
 * `Brain.ingest` re-pins it here.
 */

import { z } from 'zod';
import { parseCsv } from '../connectors/csv.js';
import { type MemoryDocument } from './documents.js';
import { deriveThemes } from './enrichment.js';
import {
  META_ACCESS,
  META_SOURCE,
  META_RECORD_ID,
  META_KIND,
  META_LAST_VERIFIED,
  META_THEMES,
} from '../constants.js';

export type IngestFormat = 'text' | 'csv' | 'json';

/** Guardrails so one paste can't flood the brain. */
export const MAX_INGEST_CHARS = 200_000;
export const MAX_INGEST_DOCS = 1_000;

export interface IngestInput {
  format: IngestFormat;
  content: string;
  /** Provenance label shown on citation chips (e.g. "meeting-notes"). */
  source: string;
  /** Access scope every emitted doc is pinned to (caller-validated upstream). */
  access: string;
  /** OKF concept `type` → record kind (defaults to "note"). */
  kind?: string;
  /** OKF `tags` → record themes (overrides the derived themes when present). */
  themes?: string;
}

/** Deterministic, dependency-free FNV-1a hash → stable id (idempotent upsert). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Sanitize a user label into a safe, lowercase provenance source. */
export function normalizeSource(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'notes';
}

function makeDoc(
  text: string,
  source: string,
  access: string,
  recordId: string,
  kind = 'note',
  themesOverride?: string,
): MemoryDocument {
  const body = text.trim();
  // Enrichment-with-guardrails: derive inspectable theme tags from the text so
  // thematic recall works across heterogeneous sources, without an LLM call.
  // An explicit OKF `tags` value wins over the derived themes.
  const themes = themesOverride?.trim() || deriveThemes(body).join(',');
  return {
    // Access scope is part of the id: the SAME text in two scopes must be two
    // records, not one. Without it, upsert (keyed by id) silently moves data
    // across a scope boundary on re-ingest — a scope-isolation hole.
    id: `${access}:${source}:${recordId}`,
    text: body,
    metadata: {
      [META_KIND]: kind,
      [META_SOURCE]: source,
      [META_RECORD_ID]: recordId,
      [META_ACCESS]: access,
      [META_LAST_VERIFIED]: todayIso(),
      ...(themes ? { [META_THEMES]: themes } : {}),
    },
  };
}

/** Render an arbitrary record as compact "Key: value" lines (skips empties). */
function renderRow(row: Record<string, unknown>): string {
  return Object.entries(row)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('\n');
}

/**
 * Build memory documents from raw ingested content. Generic by design: any text,
 * any CSV columns, or any JSON shape (object or array of objects) becomes a
 * readable, embeddable document — so the brain can ground answers on whatever the
 * caller actually has. There is no privileged schema; this is the universal
 * data-in path that the dashboard, uploads, and workflow webhooks all share.
 */
export function buildDocuments(input: IngestInput): MemoryDocument[] {
  const { content, access, kind, themes } = input;
  const source = normalizeSource(input.source);
  if (content.length > MAX_INGEST_CHARS) {
    throw new Error(`Content too large (${content.length} chars; max ${MAX_INGEST_CHARS}).`);
  }

  let docs: MemoryDocument[];
  if (input.format === 'text') {
    const chunks = content.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const parts = chunks.length ? chunks : [content.trim()].filter(Boolean);
    docs = parts.map((t) => makeDoc(t, source, access, hash(t), kind, themes));
  } else if (input.format === 'csv') {
    docs = parseCsv(content).map((row) => {
      const text = renderRow(row);
      const recordId = (row.id ?? '').trim() || hash(text);
      return makeDoc(text, source, access, recordId, kind, themes);
    });
  } else {
    const data: unknown = JSON.parse(content);
    const arr: unknown[] = Array.isArray(data) ? data : [data];
    docs = arr.map((o) => {
      const text =
        typeof o === 'string' ? o.trim() : renderRow((o ?? {}) as Record<string, unknown>);
      const recordId =
        o && typeof o === 'object' && 'id' in o && (o as { id: unknown }).id != null
          ? String((o as { id: unknown }).id)
          : hash(text);
      return makeDoc(text, source, access, recordId, kind, themes);
    });
  }

  const nonEmpty = docs.filter((d) => d.text.length > 0);
  if (nonEmpty.length > MAX_INGEST_DOCS) {
    throw new Error(`Too many records (${nonEmpty.length}; max ${MAX_INGEST_DOCS}).`);
  }
  return nonEmpty;
}

/** Validation schema for the API body (re-used by the route). */
export const IngestBodySchema = z.object({
  format: z.enum(['text', 'csv', 'json']),
  content: z.string().trim().min(1),
  source: z.string().trim().min(1).max(60).optional(),
  /** Requested write scope; the route intersects it with the caller's scopes. */
  scope: z.string().trim().optional(),
});
