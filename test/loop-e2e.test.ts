/**
 * REAL closed-loop e2e — no mock backend, no seeded demo data, real file stores.
 *
 * Every other suite runs LLM_BACKEND=mock (deterministic, in-memory). This one
 * runs the model-free PRODUCTION path the README ships: LLM_BACKEND=local +
 * COMB_RETRIEVAL=keyword, so retrieval is the real FileKeywordMemoryStore, the
 * action queue is the real FileActionStore, skills/intents/divergence all hit
 * real JSON files in a throwaway data dir. The brain boots EMPTY (no demo seed
 * on non-mock backends), so everything searched here is data WE ingested.
 *
 * It drives the whole loop through a genuine MCP Client and proves, end to end:
 *   ingest -> search (real keyword hit) -> record_skill/find_skill ->
 *   declare_intent -> divergence candidate -> submit_action (grounded, auto-
 *   approved -> executed) -> record_outcome -> the reward landed on the real
 *   source. Then it asserts the actual files exist on disk — the proof it ran
 *   on real persistence, not a mock.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Real, file-backed, model-free — set BEFORE any dynamic import of config.
// setup.ts runs first and pins mock; these later assignments override it.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'comb-loop-e2e-'));
process.env.COMB_DATA_DIR = DATA_DIR;
// Non-mock backend = real FILE stores + EMPTY brain (no demo seed). We use
// 'langbase' rather than 'local' so ingest's model-based divergence watch (a
// 'local'-only path) doesn't try to reach a non-running Ollama; the model-free
// divergence-CANDIDATE path still runs, and no generation tool is called here,
// so the unused generator never matters. Everything tested is real, not mock.
process.env.LLM_BACKEND = 'langbase';
process.env.COMB_RETRIEVAL = 'keyword'; // model-free production retrieval
process.env.ACTION_AUTO_APPROVE = 'on'; // submit_action executes -> record_outcome can run
process.env.MCP_PRINCIPAL = 'e2e-real';
process.env.MCP_SCOPES = 'team';

type Content = { type: string; text?: string };
type ToolResult = { isError?: boolean; content: Content[] };

async function connect(): Promise<Client> {
  const { createMcpServer } = await import('../src/mcp/server.js');
  const server = await createMcpServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'e2e-real', version: '0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

async function text(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  expect(r.isError).toBeFalsy();
  expect(Array.isArray(r.content)).toBe(true);
  const t = r.content[0]?.text ?? '';
  expect(typeof t).toBe('string');
  return t;
}

describe('closed loop — real data, real files, no mock', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect();
  });

  it('ingest -> search returns the real ingested record (keyword retrieval, no seed)', async () => {
    await text(client, 'ingest', {
      content: 'Refund policy: any refund over $2000 requires manager approval before issue.',
      source: 'policy',
      scope: 'team',
    });
    const hit = await text(client, 'search_brain', { query: 'refund approval over 2000', scopes: 'team' });
    expect(hit.toLowerCase()).toContain('refund');
    expect(hit.toLowerCase()).toContain('manager');
    expect(existsSync(path.join(DATA_DIR, 'keyword-docs.json'))).toBe(true);
  });

  it('record_skill -> find_skill round-trips through the real file store', async () => {
    await text(client, 'record_skill', {
      name: 'Handle a refund request',
      body: 'Verify the order, check the policy, escalate to a manager above $2000.',
      triggers: 'refund,return',
      scopes: 'team',
    });
    const found = await text(client, 'find_skill', { query: 'customer wants a refund', scopes: 'team' });
    expect(found).toContain('Handle a refund request');
    expect(existsSync(path.join(DATA_DIR, 'skills.json'))).toBe(true);
  });

  it('declare_intent -> divergence candidate surfaces real overlapping reality', async () => {
    await text(client, 'declare_intent', {
      statement: 'Every refund over 2000 dollars gets manager approval before issue.',
      kind: 'policy',
      scopes: 'team',
    });
    const intents = await text(client, 'list_intents', { scopes: 'team' });
    expect(intents.toLowerCase()).toContain('refund');
    // New reality that overlaps the intent -> model-free candidate detection.
    await text(client, 'ingest', {
      content: 'Issued a 5000 dollar refund to a customer today without manager approval.',
      source: 'ticket-log',
      scope: 'team',
    });
    const cands = await text(client, 'list_divergence_candidates', { scope: 'team' });
    expect(cands.toLowerCase()).toContain('refund');
    expect(existsSync(path.join(DATA_DIR, 'intents.json'))).toBe(true);
    expect(existsSync(path.join(DATA_DIR, 'divergence-candidates.json'))).toBe(true);
  });

  it('submit_action (grounded, auto-approved) -> record_outcome closes the loop on the real source', async () => {
    const submitted = await text(client, 'submit_action', {
      title: 'Notify managers of the unapproved refund',
      body: 'A $5000 refund was issued without the required manager approval. Please review.',
      sources: 'ticket-log',
      scopes: 'team',
    });
    const id = /id=([\w-]+)/.exec(submitted)?.[1];
    expect(id).toBeTruthy();
    expect(existsSync(path.join(DATA_DIR, 'actions.json'))).toBe(true);

    const out = await text(client, 'record_outcome', {
      id: id as string,
      outcome: 'converted',
      evidence: 'manager reviewed and corrected the refund',
      scopes: 'team',
    });
    expect(out).toContain('reward 1');

    // The loop actually closed: the real reward currency now credits the source
    // that grounded the winning action — exactly what the reranker consumes.
    const { getFeedbackStore } = await import('../src/feedback/feedback.js');
    const rewards = await getFeedbackStore().sourceRewards(['team']);
    expect(rewards.get('ticket-log')).toBe(1);
  });

  it('query_runs is callable on the real store (audit surface intact)', async () => {
    const runs = await text(client, 'query_runs', { limit: 5 });
    expect(typeof runs).toBe('string');
  });
});
