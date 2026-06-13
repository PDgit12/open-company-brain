/**
 * MCP surface — end-to-end through a REAL client (the wired-but-never-run guard).
 *
 * Every tool here was registered and self-reviewed but, until this suite, never
 * actually INVOKED across the protocol. That is the #1 AI-introduced regression:
 * a tool wired into the server that throws, returns the wrong shape, or whose
 * paired reader can't see what its writer just wrote (the "added it to the
 * response, forgot the SELECT" bug — here: write a skill, can find_skill see it?).
 *
 * We connect a genuine `Client` over an in-memory transport to the genuine
 * `createMcpServer()` and:
 *   1. assert the FULL tool roster registered (a tool that fails to register
 *      silently vanishes — listTools catches it mechanically, no AI judgment);
 *   2. invoke every tool with valid input and assert the MCP content contract
 *      (`content: [{ type: 'text', text: <string> }]`, never isError);
 *   3. exercise each write→read round-trip so a writer/reader path mismatch
 *      fails here instead of in a user's IDE.
 *
 * Hermetic: setup.ts pins LLM_BACKEND=mock; we add COMB_RETRIEVAL=keyword to
 * exercise the model-free path the README ships as the default.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Pin the connection identity + the model-free retrieval path BEFORE the server
// (and config) are constructed. principalName()/resolveScopes() read live env.
process.env.MCP_PRINCIPAL = 'e2e-agent';
process.env.MCP_SCOPES = 'default-team';
process.env.COMB_RETRIEVAL = 'keyword';

// IMPORTANT: import the server DYNAMICALLY, not statically. A static `import`
// is hoisted above the env assignments above, so config would read the default
// (vector) retrieval mode before COMB_RETRIEVAL is set — and the keyword path
// the README ships as default would never be exercised. Deferring the import
// guarantees the env is in place before config is evaluated.

/** The complete contract: every tool the host is promised. Drift here = a tool
 *  silently dropped or renamed, which breaks a user's MCP config. */
const EXPECTED_TOOLS = [
  'search_brain', 'ask_brain', 'ingest', 'list_sources',
  'propose_action', 'action_status', 'list_divergence_candidates', 'query_runs',
  'record_skill', 'find_skill', 'record_fact', 'submit_action',
  'declare_intent', 'list_intents',
].sort();

type TextContent = { type: string; text?: string };

async function connect(): Promise<Client> {
  const { createMcpServer } = await import('../src/mcp/server.js');
  const server = await createMcpServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'e2e', version: '0' });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

/** Call a tool and assert the MCP content contract; return the first text. */
async function callText(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: TextContent[];
  };
  expect(res.isError, `${name} returned isError`).not.toBe(true);
  expect(Array.isArray(res.content), `${name} content not an array`).toBe(true);
  expect(res.content.length, `${name} returned empty content`).toBeGreaterThan(0);
  expect(res.content[0].type, `${name} first content not text`).toBe('text');
  expect(typeof res.content[0].text, `${name} text not a string`).toBe('string');
  return res.content[0].text ?? '';
}

describe('MCP server — full tool roster registers', () => {
  let client: Client;
  beforeAll(async () => { client = await connect(); });

  it('exposes exactly the promised tools (no tool silently dropped)', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
  });

  it('every tool declares an input schema (schema-first per mcp-server-patterns)', async () => {
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.inputSchema, `${t.name} has no inputSchema`).toBeTruthy();
      expect(t.description, `${t.name} has no description`).toBeTruthy();
    }
  });
});

describe('MCP server — every tool is invokable end-to-end', () => {
  let client: Client;
  beforeAll(async () => { client = await connect(); });

  // ── WRITE → READ round-trips: the path-parity guard ────────────────────────

  it('ingest → search_brain: a written fact is retrievable by the reader', async () => {
    const ack = await callText(client, 'ingest', {
      content: 'Refunds over $10,000 require Finance Director approval.',
      source: 'refund-policy',
    });
    expect(ack).toMatch(/Ingested/i);
    const hits = await callText(client, 'search_brain', { query: 'who approves a large refund' });
    // The model-free retriever must surface what ingest just wrote (writer/reader parity).
    expect(hits.toLowerCase()).toContain('finance');
  });

  it('ingest → list_sources: provenance the writer created is listed', async () => {
    await callText(client, 'ingest', { content: 'Parental leave is 16 weeks.', source: 'leave-policy' });
    const sources = await callText(client, 'list_sources', {});
    expect(sources).toContain('leave-policy');
  });

  it('record_fact → search_brain: a discrete fact is retrievable', async () => {
    await callText(client, 'record_fact', { text: 'The on-call rotation is weekly, handed off on Mondays.', source: 'oncall' });
    const hits = await callText(client, 'search_brain', { query: 'when does on-call hand off' });
    expect(hits.toLowerCase()).toContain('monday');
  });

  it('record_skill → find_skill: a recorded procedure is found by trigger', async () => {
    await callText(client, 'record_skill', {
      name: 'Handle a refund request',
      body: 'verify order → check policy → credit ≤ $2k → else route to Finance',
      triggers: 'refund, money back, chargeback',
    });
    const found = await callText(client, 'find_skill', { query: 'customer wants a refund' });
    expect(found).toContain('Handle a refund request');
  });

  it('declare_intent → list_intents: a declared intent is listed', async () => {
    const ack = await callText(client, 'declare_intent', {
      statement: 'Sprint 14 ships the export API by Friday.',
      kind: 'goal',
    });
    expect(ack).toMatch(/Intent .* declared/i);
    const listed = await callText(client, 'list_intents', {});
    expect(listed).toContain('export API');
  });

  it('submit_action → action_status: a host-drafted action enters the queue and is queryable', async () => {
    const ack = await callText(client, 'submit_action', {
      title: 'Notify managers of policy change',
      body: 'The refund approval threshold is now $10,000. Please review.',
    });
    const id = ack.match(/id=([\w-]+)/)?.[1];
    expect(id, `submit_action did not return an id: "${ack}"`).toBeTruthy();
    const status = await callText(client, 'action_status', { id: id! });
    expect(status).toMatch(/Notify managers/);
  });

  // ── READ/PROVE tools: must return the empty-but-valid contract, never throw ──

  it('query_runs returns a valid response (the receipts trail)', async () => {
    await callText(client, 'query_runs', { limit: 5 });
  });

  it('list_divergence_candidates returns a valid response', async () => {
    await callText(client, 'list_divergence_candidates', {});
  });

  it('ask_brain returns a grounded-or-refused answer without throwing', async () => {
    await callText(client, 'ask_brain', { question: 'who approves a large refund?' });
  });

  it('propose_action grounds-or-refuses without throwing (governed draft path)', async () => {
    const out = await callText(client, 'propose_action', {
      title: 'Refund desk reminder',
      instruction: 'Draft a one-line reminder of the refund approval threshold.',
      query: 'refund approval threshold',
    });
    // Either a grounded proposal or an explicit refusal — both are valid contracts.
    expect(out).toMatch(/Proposed|REFUSED/);
  });

  // ── INPUT VALIDATION: schema-first means bad input is rejected, not crashed ──

  it('rejects a call that violates the input schema (zod guard active)', async () => {
    // search_brain requires `query: string`; omitting it must surface a typed
    // validation error — NOT a server crash and NOT a silent empty success.
    // This SDK returns it as isError:true content (a clean, model-readable
    // refusal) rather than throwing — which is the safe contract we want.
    const res = (await client.callTool({ name: 'search_brain', arguments: {} })) as {
      isError?: boolean;
      content: TextContent[];
    };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/validation|Required|invalid/i);
  });
});
