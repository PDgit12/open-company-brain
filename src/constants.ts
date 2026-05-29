/**
 * Shared contracts used on BOTH sides of a seam.
 *
 * The #1 way a brain like this silently breaks: ingest writes a metadata key
 * under one name and retrieval filters under a different name, so access control
 * looks enforced but isn't. Every such key lives here ONCE and is imported by
 * both the writer (sync) and the reader (retrieval). Never inline these strings.
 */

/** Metadata key carrying the access scope an entity belongs to. */
export const META_ACCESS = 'access' as const;

/** Metadata key carrying the originating table / source system (provenance). */
export const META_SOURCE = 'source' as const;

/** Metadata key carrying the stable record id within its source. */
export const META_RECORD_ID = 'record_id' as const;

/** Metadata key carrying the entity kind (company | contact | engagement | ...). */
export const META_KIND = 'kind' as const;

/** Metadata key carrying the company a record is associated with. */
export const META_COMPANY = 'company' as const;

/** Metadata key carrying the last-verified ISO date (freshness / trust signal). */
export const META_LAST_VERIFIED = 'last_verified' as const;
