/**
 * The canonical EXAMPLE domain model.
 *
 * This ships modelling a generic relationship/CRM domain (companies, contacts,
 * engagements, programs) so the project is useful out of the box. It is only an
 * example — swap these types for your own entities and the rest of the brain
 * (recall, graph, agents) works unchanged.
 *
 * This is the brain's internal shape. Your real Postgres tables do NOT have to
 * match it — `src/adapter/index.ts` maps your columns onto these types. Keep
 * this model stable; adapt at the edge.
 *
 * The relationships between these entities (a Contact works AT a Company; an
 * Engagement is WITH a Company) are the knowledge graph — see src/graph.
 */

export type AccessScope = string; // e.g. "default-team", "leadership"

export interface Company {
  id: string;
  name: string;
  industry: string | null;
  /** e.g. "Platinum" | "Gold" | "Prospect" */
  partnershipTier: string | null;
  /** Free-text summary of the relationship. */
  summary: string | null;
  /** Who may see this record. */
  access: AccessScope;
  updatedAt: string; // ISO
}

export interface Contact {
  id: string;
  companyId: string; // FK → Company.id   (a graph edge)
  name: string;
  title: string | null;
  email: string | null;
  notes: string | null;
  access: AccessScope;
  updatedAt: string;
}

export interface Engagement {
  id: string;
  companyId: string; // FK → Company.id   (a graph edge)
  /** e.g. "sponsorship", "recruiting", "research-funding", "event". */
  kind: string;
  /** ISO date of the engagement. */
  date: string;
  summary: string;
  /** Open action items, if any. */
  openActions: string | null;
  access: AccessScope;
  updatedAt: string;
}

export interface Program {
  id: string;
  name: string;
  description: string | null;
  access: AccessScope;
  updatedAt: string;
}

/** Many-to-many: which companies engage with which programs (a graph edge). */
export interface CompanyProgram {
  companyId: string;
  programId: string;
}

/** Everything the data layer can hand the brain, already in domain shape. */
export interface BrainSnapshot {
  companies: Company[];
  contacts: Contact[];
  engagements: Engagement[];
  programs: Program[];
  companyPrograms: CompanyProgram[];
}

export type EntityKind = 'company' | 'contact' | 'engagement' | 'program';
