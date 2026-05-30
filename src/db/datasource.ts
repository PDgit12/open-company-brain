/**
 * The data source abstraction.
 *
 * The brain only ever talks to `BrainDataSource`. Two implementations exist:
 *   • PostgresDataSource — reads YOUR Postgres via the adapter SQL.
 *   • SeedDataSource     — serves synthetic in-memory data (zero-credential demo).
 *
 * config.dataMode decides which one `createDataSource()` returns. Nothing
 * downstream knows or cares which it got — that is the seam that lets the same
 * brain run as a showcase today and against real data tomorrow.
 */

import pg from 'pg';
import { config } from '../config.js';
import type { BrainSnapshot } from '../domain/types.js';
import {
  SQL,
  mapCompany,
  mapContact,
  mapEngagement,
  mapProgram,
  mapCompanyProgram,
  type CompanyRow,
  type ContactRow,
  type EngagementRow,
  type ProgramRow,
  type CompanyProgramRow,
} from '../adapter/index.js';
import { SEED_SNAPSHOT } from '../seed/seed-data.js';
import { CsvConnector } from '../connectors/csv.js';
import { JsonConnector } from '../connectors/json.js';

export interface BrainDataSource {
  /** Pull the full current state of the brain's source-of-truth. */
  loadSnapshot(): Promise<BrainSnapshot>;
  /** Release any held resources (db pools). Safe to call always. */
  close(): Promise<void>;
}

class SeedDataSource implements BrainDataSource {
  async loadSnapshot(): Promise<BrainSnapshot> {
    // Return a deep copy so callers can't mutate the shared fixture.
    return structuredClone(SEED_SNAPSHOT);
  }
  async close(): Promise<void> {
    /* nothing to release */
  }
}

class PostgresDataSource implements BrainDataSource {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async loadSnapshot(): Promise<BrainSnapshot> {
    const [companies, contacts, engagements, programs, companyPrograms] =
      await Promise.all([
        this.pool.query<CompanyRow>(SQL.companies),
        this.pool.query<ContactRow>(SQL.contacts),
        this.pool.query<EngagementRow>(SQL.engagements),
        this.pool.query<ProgramRow>(SQL.programs),
        this.pool.query<CompanyProgramRow>(SQL.companyPrograms),
      ]);

    return {
      companies: companies.rows.map(mapCompany),
      contacts: contacts.rows.map(mapContact),
      engagements: engagements.rows.map(mapEngagement),
      programs: programs.rows.map(mapProgram),
      companyPrograms: companyPrograms.rows.map(mapCompanyProgram),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDataSource(): BrainDataSource {
  const { kind, path } = config.connector;

  // Explicit connector selection wins.
  if (kind === 'csv') {
    if (!path) throw new Error('DATA_CONNECTOR=csv requires CONNECTOR_PATH (a folder of CSVs).');
    return new CsvConnector(path);
  }
  if (kind === 'json') {
    if (!path) throw new Error('DATA_CONNECTOR=json requires CONNECTOR_PATH (a snapshot.json file).');
    return new JsonConnector(path);
  }
  if (kind === 'postgres' || (kind === 'auto' && config.dataMode === 'postgres')) {
    if (!config.database.url) throw new Error('Postgres connector requires DATABASE_URL.');
    return new PostgresDataSource(config.database.url);
  }
  return new SeedDataSource();
}
