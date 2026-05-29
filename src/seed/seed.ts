/**
 * Load the canonical schema + synthetic seed data into a local Postgres.
 *
 * Run: `npm run seed:db`   (requires DATABASE_URL in .env)
 *
 * This is ONLY needed if you want to exercise LIVE Postgres mode locally. The
 * default mock mode needs none of this. Idempotent: it upserts.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { SEED_SNAPSHOT } from './seed-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  if (!config.database.url) {
    console.error('✗ DATABASE_URL is not set. Seeding Postgres requires it.');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: config.database.url });
  const schema = await readFile(path.resolve(__dirname, '../../db/schema.sql'), 'utf8');

  try {
    await pool.query(schema);

    const s = SEED_SNAPSHOT;
    for (const c of s.companies) {
      await pool.query(
        `INSERT INTO companies (id,name,industry,partnership_tier,summary,access,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, industry=EXCLUDED.industry,
           partnership_tier=EXCLUDED.partnership_tier, summary=EXCLUDED.summary, access=EXCLUDED.access`,
        [c.id, c.name, c.industry, c.partnershipTier, c.summary, c.access, c.updatedAt],
      );
    }
    for (const c of s.contacts) {
      await pool.query(
        `INSERT INTO contacts (id,company_id,name,title,email,notes,access,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, title=EXCLUDED.title,
           email=EXCLUDED.email, notes=EXCLUDED.notes, access=EXCLUDED.access`,
        [c.id, c.companyId, c.name, c.title, c.email, c.notes, c.access, c.updatedAt],
      );
    }
    for (const e of s.engagements) {
      await pool.query(
        `INSERT INTO engagements (id,company_id,kind,date,summary,open_actions,access,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind, date=EXCLUDED.date,
           summary=EXCLUDED.summary, open_actions=EXCLUDED.open_actions, access=EXCLUDED.access`,
        [e.id, e.companyId, e.kind, e.date, e.summary, e.openActions, e.access, e.updatedAt],
      );
    }
    for (const p of s.programs) {
      await pool.query(
        `INSERT INTO programs (id,name,description,access,updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, access=EXCLUDED.access`,
        [p.id, p.name, p.description, p.access, p.updatedAt],
      );
    }
    for (const link of s.companyPrograms) {
      await pool.query(
        `INSERT INTO company_programs (company_id,program_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [link.companyId, link.programId],
      );
    }
    console.log('✓ Seeded local Postgres with synthetic sample data.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('✗ Seed failed:', err);
  process.exit(1);
});
