import { describe, it, expect, beforeAll } from 'vitest';

/**
 * OPT-IN local end-to-end test — the real fully-local backend.
 *
 *   RUN_LOCAL_E2E=1 npm test
 *
 * SKIPPED by default so `npm test` stays hermetic (no Ollama / no Postgres /
 * no Docker required for contributors and CI). Run it manually when the local
 * stack is up:
 *   ollama serve && ollama pull llama3.2:1b nomic-embed-text
 *   docker compose up -d
 *   RUN_LOCAL_E2E=1 VECTOR_DATABASE_URL=postgres://brain:brain@localhost:5433/company_brain npm test
 *
 * It pins the env BEFORE importing the app config (which freezes at import time),
 * then drives the real Ollama generation + Ollama embeddings + pgvector recall.
 */
const RUN = process.env.RUN_LOCAL_E2E === '1';

describe.skipIf(!RUN)('local backend e2e (Ollama + pgvector)', () => {
  let brain: import('../src/brain/brain.js').Brain;

  beforeAll(async () => {
    process.env.LLM_BACKEND = 'local';
    process.env.VECTOR_DATABASE_URL ||= 'postgres://brain:brain@localhost:5433/company_brain';
    // Import AFTER env is set so config resolves to the local backend.
    const { Brain } = await import('../src/brain/brain.js');
    const { runSync } = await import('../src/brain/sync.js');
    await runSync({ full: true }); // embed seed data into pgvector via local embeddings
    brain = await Brain.create();
  }, 120_000);

  it('answers a grounded question with real sources', async () => {
    const res = await brain.ask('What is our history with Aerodyne?', ['default-team']);
    expect(res.sources.length).toBeGreaterThan(0);
    expect(res.answer.length).toBeGreaterThan(0);
  }, 60_000);

  it('refuses on a nonsense query (min-score floor preserves cite-or-refuse)', async () => {
    const res = await brain.ask('xylophone quantum banana', ['default-team']);
    expect(res.sources).toHaveLength(0);
  }, 60_000);

  it('enforces access scope: default-team never sees leadership records', async () => {
    const res = await brain.ask('confidential mandate sensitive figures', ['default-team']);
    expect(res.sources).toHaveLength(0);
  }, 60_000);
});
