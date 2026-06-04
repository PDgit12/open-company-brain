/**
 * The memory document — the one shape everything in the brain agrees on.
 *
 * The recall layer is semantic: it searches text by meaning. So every piece of
 * knowledge — whether pasted by a person, uploaded as CSV/JSON, or pushed in by a
 * workflow (n8n, Zapier, a cron job) — is rendered into a compact, self-contained
 * text "memory document" plus metadata. The text is what gets embedded and
 * matched; the metadata is what enforces provenance and access at retrieval time.
 *
 * This file deliberately holds NO domain model. The brain is universal: it has no
 * idea whether a document is a CRM record, a support ticket, a meeting note or a
 * product spec — and that is the point. Shape your data with `src/brain/ingest.ts`.
 */

export interface MemoryDocument {
  /** Stable id, unique across the whole brain: `${source}:${recordId}`. */
  id: string;
  /** The embeddable text the agent will read. */
  text: string;
  /** Filterable metadata. Keys come from constants.ts (the seam contract). */
  metadata: Record<string, string>;
}
