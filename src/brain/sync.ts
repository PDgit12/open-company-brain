/**
 * Sync CLI — reads the source of truth and (re)builds the recall layer.
 *
 * Run: `npm run sync`
 *
 * In LIVE mode this uploads/refreshes documents in Langbase Memory. In MOCK mode
 * it exercises the exact same code path against the in-memory store, so the sync
 * pipeline is verifiable without credentials. Idempotent: safe to run repeatedly.
 *
 * Schedule this (cron / a webhook on form submit) to keep the brain fresh.
 */

import { createDataSource } from '../db/datasource.js';
import { createMemoryStore } from './memory.js';
import { snapshotToDocuments } from './documents.js';
import { describeMode } from '../config.js';

export async function runSync(): Promise<{ documents: number }> {
  const dataSource = createDataSource();
  try {
    const snapshot = await dataSource.loadSnapshot();
    const docs = snapshotToDocuments(snapshot);
    const memory = createMemoryStore();
    const count = await memory.upsert(docs);
    return { documents: count };
  } finally {
    await dataSource.close();
  }
}

// Run when invoked directly (node/tsx), not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`▸ Sync starting  (${describeMode()})`);
  runSync()
    .then(({ documents }) => {
      console.log(`✓ Sync complete — ${documents} documents in the brain.`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('✗ Sync failed:', err);
      process.exit(1);
    });
}
