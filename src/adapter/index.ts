/**
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │  THE ADAPTER — the single most important file when you wire your own data.  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * You are building the webapp + database. Your tables will NOT be named exactly
 * like the brain's domain model. This file is the ONE place you reconcile them.
 *
 * Two responsibilities:
 *   1. SQL — the queries that pull rows out of YOUR Postgres tables.
 *   2. mapRow* — functions that turn one of YOUR rows into a domain object.
 *
 * If your table is `partner_orgs` with a column `org_name`, you change the SQL
 * and the mapper here — and nothing else in the codebase needs to move. That is
 * the whole point: adapt at the edge, keep the core stable.
 *
 * Everything below is written against the canonical schema in db/schema.sql.
 * Edit it to match your reality.
 */

import type {
  Company,
  Contact,
  Engagement,
  Program,
  CompanyProgram,
} from '../domain/types.js';

/** Raw row shapes as returned by the SQL below. Adjust to match your columns. */
interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  partnership_tier: string | null;
  summary: string | null;
  access: string | null;
  updated_at: Date | string;
}
interface ContactRow {
  id: string;
  company_id: string;
  name: string;
  title: string | null;
  email: string | null;
  notes: string | null;
  access: string | null;
  updated_at: Date | string;
}
interface EngagementRow {
  id: string;
  company_id: string;
  kind: string;
  date: Date | string;
  summary: string;
  open_actions: string | null;
  access: string | null;
  updated_at: Date | string;
}
interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  access: string | null;
  updated_at: Date | string;
}
interface CompanyProgramRow {
  company_id: string;
  program_id: string;
}

const toIso = (d: Date | string): string =>
  d instanceof Date ? d.toISOString() : new Date(d).toISOString();

const DEFAULT_ACCESS = 'default-team';

/**
 * SQL used by the Postgres data source. Change table/column names here to point
 * at your real schema. Keep the SELECT *aliases* (right-hand names) identical so
 * the row interfaces and mappers keep working.
 */
export const SQL = {
  companies: `
    SELECT id, name, industry, partnership_tier, summary, access, updated_at
    FROM companies
    ORDER BY name`,
  contacts: `
    SELECT id, company_id, name, title, email, notes, access, updated_at
    FROM contacts
    ORDER BY name`,
  engagements: `
    SELECT id, company_id, kind, date, summary, open_actions, access, updated_at
    FROM engagements
    ORDER BY date DESC`,
  programs: `
    SELECT id, name, description, access, updated_at
    FROM programs
    ORDER BY name`,
  companyPrograms: `
    SELECT company_id, program_id
    FROM company_programs`,
} as const;

export const mapCompany = (r: CompanyRow): Company => ({
  id: String(r.id),
  name: r.name,
  industry: r.industry,
  partnershipTier: r.partnership_tier,
  summary: r.summary,
  access: r.access ?? DEFAULT_ACCESS,
  updatedAt: toIso(r.updated_at),
});

export const mapContact = (r: ContactRow): Contact => ({
  id: String(r.id),
  companyId: String(r.company_id),
  name: r.name,
  title: r.title,
  email: r.email,
  notes: r.notes,
  access: r.access ?? DEFAULT_ACCESS,
  updatedAt: toIso(r.updated_at),
});

export const mapEngagement = (r: EngagementRow): Engagement => ({
  id: String(r.id),
  companyId: String(r.company_id),
  kind: r.kind,
  date: toIso(r.date).slice(0, 10),
  summary: r.summary,
  openActions: r.open_actions,
  access: r.access ?? DEFAULT_ACCESS,
  updatedAt: toIso(r.updated_at),
});

export const mapProgram = (r: ProgramRow): Program => ({
  id: String(r.id),
  name: r.name,
  description: r.description,
  access: r.access ?? DEFAULT_ACCESS,
  updatedAt: toIso(r.updated_at),
});

export const mapCompanyProgram = (r: CompanyProgramRow): CompanyProgram => ({
  companyId: String(r.company_id),
  programId: String(r.program_id),
});

export type {
  CompanyRow,
  ContactRow,
  EngagementRow,
  ProgramRow,
  CompanyProgramRow,
};
