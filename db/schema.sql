-- Company Brain — canonical EXAMPLE schema (local Postgres).
--
-- This is the brain's reference schema for the example domain. Your real tables
-- may differ; if so, keep this for reference and adjust src/adapter/index.ts to
-- map yours (and src/domain/types.ts if your entities differ).
-- The foreign keys here ARE the knowledge graph (contacts→companies, etc.).

CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  industry        TEXT,
  partnership_tier TEXT,
  summary         TEXT,
  access          TEXT NOT NULL DEFAULT 'default-team',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  title       TEXT,
  email       TEXT,
  notes       TEXT,
  access      TEXT NOT NULL DEFAULT 'default-team',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagements (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  date         DATE NOT NULL,
  summary      TEXT NOT NULL,
  open_actions TEXT,
  access       TEXT NOT NULL DEFAULT 'default-team',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS programs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  access      TEXT NOT NULL DEFAULT 'default-team',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_programs (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  program_id TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, program_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_engagements_company ON engagements(company_id);
