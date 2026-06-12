/**
 * One-command fully-local setup — `npm run setup:local`.
 *
 * Brings the $0/query backend (Ollama + pgvector) to a ready state:
 *   1. Ollama is reachable, and the generation + embedding models are pulled.
 *   2. The pgvector Postgres is reachable (the store creates its own table).
 *   3. The source of truth is embedded into pgvector (local sync).
 *
 * Idempotent and safe to re-run. Requires LLM_BACKEND=local. The two things it
 * can't conjure — a running `ollama serve` and a running Postgres — are detected
 * and reported with the exact command to fix them.
 */

import { execFileSync } from 'node:child_process';
import { config, describeMode } from '../config.js';
import { createMemoryStore } from './memory.js';
import { demoDocuments } from '../seed/seed-data.js';

async function ollamaTags(): Promise<string[]> {
  const res = await fetch(`${config.ollama.baseUrl}/api/tags`);
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
  const json = (await res.json()) as { models?: { name: string }[] };
  return (json.models ?? []).map((m) => m.name);
}

function hasModel(tags: string[], model: string): boolean {
  return tags.some(
    (t) => t === model || t === `${model}:latest` || (!model.includes(':') && t.startsWith(`${model}:`)),
  );
}

function pull(model: string): void {
  console.log(`  ↓ pulling ${model} …`);
  execFileSync('ollama', ['pull', model], { stdio: 'inherit' });
}

export async function setupLocal(): Promise<void> {
  if (config.backend !== 'local') {
    throw new Error('Not in local mode — set LLM_BACKEND=local in .env (or env) first.');
  }
  if (!config.ollama.vectorDatabaseUrl) {
    throw new Error('No Postgres configured — set VECTOR_DATABASE_URL (or DATABASE_URL). Try `docker compose up -d`.');
  }

  // 1. Ollama + models.
  let tags: string[];
  try {
    tags = await ollamaTags();
  } catch {
    throw new Error(`Ollama is not reachable at ${config.ollama.baseUrl}. Start it with: ollama serve`);
  }
  for (const model of [config.ollama.generationModel, config.ollama.embeddingModel]) {
    if (hasModel(tags, model)) console.log(`✓ Ollama model "${model}" present.`);
    else pull(model);
  }

  // 2 + 3. Provision pgvector (the store creates the extension + table on first
  //        write; throws clearly if PG is down). DEMO DATA IS OPT-IN: a real
  //        backend boots EMPTY and is fed by `comb ingest` / the webhook — demo
  //        notes only land if you explicitly pass --seed-demo.
  const seedDemo = process.argv.includes('--seed-demo');
  try {
    const store = createMemoryStore();
    if (seedDemo) {
      const seeded = await store.upsert(demoDocuments());
      console.log(`✓ Seeded ${seeded} demo document(s) into pgvector (--seed-demo).`);
    } else {
      // Touch the store so provisioning still happens (and PG errors surface).
      await store.stats([config.demoUserAccessScope]);
      console.log('✓ pgvector ready — brain is EMPTY. Feed it: `comb ingest <file>` (demo notes: --seed-demo).');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ECONNREFUSED|connect|password|database .* does not exist/i.test(msg)) {
      throw new Error(`Postgres not reachable at VECTOR_DATABASE_URL. Start it with \`docker compose up -d\`. (${msg})`);
    }
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`▸ Local setup starting  (${describeMode()})`);
  setupLocal()
    .then(() => {
      console.log('\n✓ Fully-local setup complete. Start it: npm run demo  ($0 per query)\n');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    });
}
