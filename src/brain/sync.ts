/**
 * Sync CLI — reads the source of truth and (re)builds the recall layer.
 *
 * Modes:
 *   npm run sync           incremental — only records changed since last sync
 *   npm run sync -- --full full rebuild of every document
 *
 * Incremental sync reads a watermark (the latest updatedAt seen last time) from
 * a small state file and only re-embeds what changed. The first run, or --full,
 * does everything. Idempotent either way.
 *
 * Schedule this (cron, or a webhook on form submit) to keep the brain fresh.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createDataSource } from '../db/datasource.js';
import { createMemoryStore } from './memory.js';
import { snapshotToDocuments, latestTimestamp } from './documents.js';
import { describeMode } from '../config.js';

const STATE_FILE = '.brain-state.json';

interface SyncState {
  watermark: string;
}

async function readWatermark(): Promise<string | undefined> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    return (JSON.parse(raw) as SyncState).watermark || undefined;
  } catch {
    return undefined; // no prior sync
  }
}

async function writeWatermark(watermark: string): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify({ watermark }, null, 2));
}

export interface SyncResult {
  documents: number;
  mode: 'full' | 'incremental';
  watermark: string;
}

export async function runSync(opts: { full?: boolean } = {}): Promise<SyncResult> {
  const dataSource = createDataSource();
  try {
    const snapshot = await dataSource.loadSnapshot();
    const since = opts.full ? undefined : await readWatermark();
    const docs = snapshotToDocuments(snapshot, since !== undefined ? { since } : {});
    const memory = createMemoryStore();
    const count = await memory.upsert(docs);
    const watermark = latestTimestamp(snapshot);
    if (watermark) await writeWatermark(watermark);
    return { documents: count, mode: since === undefined ? 'full' : 'incremental', watermark };
  } finally {
    await dataSource.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const full = process.argv.includes('--full');
  console.log(`▸ Sync starting (${full ? 'full' : 'incremental'})  (${describeMode()})`);
  runSync({ full })
    .then(({ documents, mode }) => {
      console.log(`✓ Sync complete — ${documents} document(s) upserted (${mode}).`);
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('✗ Sync failed:', err);
      process.exit(1);
    });
}
