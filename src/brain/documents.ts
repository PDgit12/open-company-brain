/**
 * Document templating — how a structured record "enters the brain".
 *
 * The recall layer (Langbase Memory) is semantic: it searches text by meaning.
 * So each structured record is rendered into a compact, self-contained text
 * "memory document" plus metadata. The text is what gets embedded and matched;
 * the metadata is what enforces provenance and access at retrieval time.
 *
 * These functions are PURE (no I/O) so they are trivially testable and
 * deterministic — the foundation the rest of the brain stands on.
 */

import {
  META_ACCESS,
  META_SOURCE,
  META_RECORD_ID,
  META_KIND,
  META_COMPANY,
  META_LAST_VERIFIED,
  META_THEMES,
} from '../constants.js';
import { deriveThemes } from './enrichment.js';
import type {
  BrainSnapshot,
  Company,
  Contact,
  Engagement,
} from '../domain/types.js';

export interface MemoryDocument {
  /** Stable id, unique across the whole brain: `${kind}:${recordId}`. */
  id: string;
  /** The embeddable text the agent will read. */
  text: string;
  /** Filterable metadata. Keys come from constants.ts (the seam contract). */
  metadata: Record<string, string>;
}

const line = (label: string, value: string | null | undefined): string =>
  value ? `${label}: ${value}\n` : '';

export function companyToDocument(
  c: Company,
  contacts: Contact[],
  engagements: Engagement[],
): MemoryDocument {
  // SECURITY: only embed children that share this company's access scope. A more
  // restricted child (e.g. a leadership-only engagement) must NOT leak into a
  // company document visible to a broader audience. Such records still exist as
  // their own scoped documents and are retrievable only by the right scope.
  const companyContacts = contacts.filter(
    (x) => x.companyId === c.id && x.access === c.access,
  );
  const companyEngagements = engagements
    .filter((x) => x.companyId === c.id && x.access === c.access)
    .slice(0, 5);

  // Enrichment: derive theme tags from the company's own text + its engagements.
  const themes = deriveThemes(
    c.summary,
    c.industry,
    ...companyEngagements.map((e) => `${e.kind} ${e.summary}`),
  );

  const text =
    `Company: ${c.name}\n` +
    line('Industry', c.industry) +
    line('Partnership tier', c.partnershipTier) +
    line('Summary', c.summary) +
    (themes.length ? `Themes: ${themes.join(', ')}\n` : '') +
    (companyContacts.length
      ? `Key contacts: ${companyContacts
          .map((k) => `${k.name}${k.title ? ` (${k.title})` : ''}`)
          .join('; ')}\n`
      : '') +
    (companyEngagements.length
      ? `Recent engagements:\n${companyEngagements
          .map((e) => `  - ${e.date} [${e.kind}] ${e.summary}`)
          .join('\n')}\n`
      : '');

  return {
    id: `company:${c.id}`,
    text: text.trim(),
    metadata: {
      [META_KIND]: 'company',
      [META_SOURCE]: 'companies',
      [META_RECORD_ID]: c.id,
      [META_COMPANY]: c.name,
      [META_ACCESS]: c.access,
      [META_LAST_VERIFIED]: c.updatedAt.slice(0, 10),
      [META_THEMES]: themes.join(','),
    },
  };
}

export function contactToDocument(c: Contact, companyName: string): MemoryDocument {
  const text =
    `Contact: ${c.name}\n` +
    line('Title', c.title) +
    line('Company', companyName) +
    line('Email', c.email) +
    line('Notes', c.notes);

  return {
    id: `contact:${c.id}`,
    text: text.trim(),
    metadata: {
      [META_KIND]: 'contact',
      [META_SOURCE]: 'contacts',
      [META_RECORD_ID]: c.id,
      [META_COMPANY]: companyName,
      [META_ACCESS]: c.access,
      [META_LAST_VERIFIED]: c.updatedAt.slice(0, 10),
    },
  };
}

export function engagementToDocument(
  e: Engagement,
  companyName: string,
): MemoryDocument {
  const text =
    `Engagement with ${companyName}\n` +
    line('Date', e.date) +
    line('Type', e.kind) +
    line('Summary', e.summary) +
    line('Open actions', e.openActions);

  return {
    id: `engagement:${e.id}`,
    text: text.trim(),
    metadata: {
      [META_KIND]: 'engagement',
      [META_SOURCE]: 'engagements',
      [META_RECORD_ID]: e.id,
      [META_COMPANY]: companyName,
      [META_ACCESS]: e.access,
      [META_LAST_VERIFIED]: e.updatedAt.slice(0, 10),
    },
  };
}

/**
 * Render a snapshot into memory documents.
 *
 * With `opts.since` set, only documents whose underlying record changed after
 * that timestamp are emitted (incremental sync). A company document is re-emitted
 * if the company OR any of its contacts/engagements changed, so the aggregated
 * company view never goes stale.
 */
export function snapshotToDocuments(
  snap: BrainSnapshot,
  opts: { since?: string } = {},
): MemoryDocument[] {
  const since = opts.since;
  const companyName = new Map(snap.companies.map((c) => [c.id, c.name]));
  const newer = (ts: string): boolean => since === undefined || ts > since;
  const docs: MemoryDocument[] = [];

  for (const c of snap.companies) {
    const childChanged =
      snap.contacts.some((x) => x.companyId === c.id && newer(x.updatedAt)) ||
      snap.engagements.some((x) => x.companyId === c.id && newer(x.updatedAt));
    if (newer(c.updatedAt) || childChanged) {
      docs.push(companyToDocument(c, snap.contacts, snap.engagements));
    }
  }
  for (const c of snap.contacts) {
    if (newer(c.updatedAt)) docs.push(contactToDocument(c, companyName.get(c.companyId) ?? 'Unknown'));
  }
  for (const e of snap.engagements) {
    if (newer(e.updatedAt)) docs.push(engagementToDocument(e, companyName.get(e.companyId) ?? 'Unknown'));
  }
  return docs;
}

/** Latest updatedAt across all records — the next sync watermark. */
export function latestTimestamp(snap: BrainSnapshot): string {
  const all = [
    ...snap.companies.map((c) => c.updatedAt),
    ...snap.contacts.map((c) => c.updatedAt),
    ...snap.engagements.map((e) => e.updatedAt),
    ...snap.programs.map((p) => p.updatedAt),
  ];
  return all.reduce((max, ts) => (ts > max ? ts : max), '');
}
