/**
 * One-command live provisioning — `npm run setup:live`.
 *
 * Brings a fresh Langbase workspace up to the state the brain expects, idempotently:
 *   1. the recall Memory exists (with the configured embedding model),
 *   2. the generation Pipe exists (with the configured model + system prompt),
 *   3. the seed (or Postgres) data is synced into recall.
 *
 * Run it once after you add an LLM provider key in the Langbase dashboard. It is
 * safe to re-run — memory/pipe creation upserts, and sync is idempotent.
 *
 * The one thing this CANNOT do for you: add the provider key. Langbase has no
 * API for that; it is a dashboard action (Settings → LLM API keys). If the key
 * is missing, this script detects the provider error and tells you exactly that.
 */

import { Langbase } from 'langbase';
import { config, describeMode } from '../config.js';
import { SYSTEM_PROMPT } from '../agents/prompts.js';
import { runSync } from './sync.js';

const PROVIDER_HINT =
  'Your Langbase workspace has no key for this model provider yet. ' +
  'Add one in the dashboard → Settings → LLM API keys, then re-run `npm run setup:live`.';

function isProviderKeyError(err: unknown): boolean {
  return err instanceof Error && /No key found for provider/i.test(err.message);
}

export async function setupLive(): Promise<void> {
  if (config.memoryMode !== 'live' || !config.langbase.apiKey) {
    throw new Error('Not in live mode — set LANGBASE_API_KEY in .env first.');
  }
  const lb = new Langbase({ apiKey: config.langbase.apiKey });

  // 1. Memory (idempotent: create, tolerate "already exists").
  try {
    await lb.memories.create({
      name: config.langbase.memoryName,
      description: 'Company Brain — semantic recall layer',
      embedding_model: config.langbase.embeddingModel,
    });
    console.log(`✓ Memory "${config.langbase.memoryName}" ready (${config.langbase.embeddingModel}).`);
  } catch (err) {
    if (isProviderKeyError(err)) throw new Error(`Embedding provider key missing. ${PROVIDER_HINT}`);
    console.log(`✓ Memory "${config.langbase.memoryName}" already exists.`);
  }

  // 2. Pipe (upsert keeps it idempotent and lets you re-run after prompt edits).
  await lb.pipes.create({
    name: config.langbase.pipeName,
    upsert: true,
    model: config.langbase.generationModel,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
  });
  console.log(`✓ Pipe "${config.langbase.pipeName}" ready (${config.langbase.generationModel}).`);

  // 3. Sync the source of truth into recall (full rebuild).
  const { documents } = await runSync({ full: true });
  console.log(`✓ Synced ${documents} document(s) into recall.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`▸ Live setup starting  (${describeMode()})`);
  setupLive()
    .then(() => {
      console.log('\n✓ Live setup complete. Try: curl -s localhost:4000/api/ask -H "content-type: application/json" -d \'{"question":"history with Aerodyne?"}\'\n');
      process.exit(0);
    })
    .catch((err: unknown) => {
      if (isProviderKeyError(err)) {
        console.error(`\n✗ ${PROVIDER_HINT}\n`);
      } else {
        console.error('✗ Live setup failed:', err instanceof Error ? err.message : err);
      }
      process.exit(1);
    });
}
