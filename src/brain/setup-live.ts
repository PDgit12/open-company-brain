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
import { createMemoryStore } from './memory.js';
import { demoDocuments } from '../seed/seed-data.js';

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
  const memoryName = config.langbase.memoryName;
  const wantModel = config.langbase.embeddingModel;

  const create = async (): Promise<void> => {
    try {
      await lb.memories.create({ name: memoryName, description: 'Company Brain — semantic recall layer', embedding_model: wantModel });
    } catch (err) {
      if (isProviderKeyError(err)) throw new Error(`Embedding provider key missing. ${PROVIDER_HINT}`);
      throw err;
    }
  };

  // 1. Memory. A memory's embedding model is fixed at creation, so if the
  //    existing one uses a different provider we must recreate it — but ONLY
  //    when it is empty, so real data is never silently destroyed.
  const existing = (await lb.memories.list()).find((m) => m.name === memoryName) as
    | { embeddingModel?: string }
    | undefined;
  if (!existing) {
    await create();
    console.log(`✓ Memory "${memoryName}" created (${wantModel}).`);
  } else if (existing.embeddingModel === wantModel) {
    console.log(`✓ Memory "${memoryName}" ready (${wantModel}).`);
  } else {
    const docs = await lb.memories.documents.list({ memoryName });
    const count = Array.isArray(docs) ? docs.length : 0;
    if (count > 0) {
      throw new Error(
        `Memory "${memoryName}" uses ${existing.embeddingModel} but config wants ${wantModel}, ` +
          `and it holds ${count} document(s). Refusing to delete real data. ` +
          `Either set LANGBASE_EMBEDDING_MODEL=${existing.embeddingModel}, or rename LANGBASE_MEMORY_NAME to provision a fresh one.`,
      );
    }
    await lb.memories.delete({ name: memoryName });
    await create();
    console.log(`✓ Memory "${memoryName}" recreated for ${wantModel} (was ${existing.embeddingModel}, 0 docs).`);
  }

  // 2. Pipe (upsert keeps it idempotent and lets you re-run after prompt edits).
  await lb.pipes.create({
    name: config.langbase.pipeName,
    upsert: true,
    model: config.langbase.generationModel,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
  });
  console.log(`✓ Pipe "${config.langbase.pipeName}" ready (${config.langbase.generationModel}).`);

  // 3. Seed the recall layer with the generic demo notes so a fresh workspace
  //    isn't empty. In real use you replace these by ingesting your own data
  //    (dashboard / upload / the ingest webhook).
  const seeded = await createMemoryStore().upsert(demoDocuments());
  console.log(`✓ Seeded ${seeded} demo document(s) into recall (replace with your data via ingest).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`▸ Live setup starting  (${describeMode()})`);
  setupLive()
    .then(() => {
      console.log('\n✓ Live setup complete. Try: curl -s localhost:4000/api/ask -H "content-type: application/json" -d \'{"question":"What is Project Atlas?"}\'\n');
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
