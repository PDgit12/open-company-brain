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
} from '../constants.js';
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
  const companyContacts = contacts.filter((x) => x.companyId === c.id);
  const companyEngagements = engagements
    .filter((x) => x.companyId === c.id)
    .slice(0, 5);

  const text =
    `Company: ${c.name}\n` +
    line('Industry', c.industry) +
    line('Partnership tier', c.partnershipTier) +
    line('Summary', c.summary) +
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

/** Render an entire snapshot into the full set of memory documents. */
export function snapshotToDocuments(snap: BrainSnapshot): MemoryDocument[] {
  const companyName = new Map(snap.companies.map((c) => [c.id, c.name]));
  const docs: MemoryDocument[] = [];

  for (const c of snap.companies) {
    docs.push(companyToDocument(c, snap.contacts, snap.engagements));
  }
  for (const c of snap.contacts) {
    docs.push(contactToDocument(c, companyName.get(c.companyId) ?? 'Unknown'));
  }
  for (const e of snap.engagements) {
    docs.push(engagementToDocument(e, companyName.get(e.companyId) ?? 'Unknown'));
  }
  return docs;
}
