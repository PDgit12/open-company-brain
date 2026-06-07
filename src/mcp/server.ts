/**
 * MCP server — the third door: expose the governed brain to ANY agentic
 * environment (Claude Code, Claude Desktop, Cursor, …) as native tools.
 *
 * This is a thin adapter over the SAME `Brain` core the HTTP API and dashboard
 * use. Point it at the same persistent store (pgvector/Langbase) and the three
 * doors become one live brain: data a workflow ingests over HTTP is instantly
 * searchable here, in your IDE.
 *
 * Two ways an agent "runs" through here, both governed + cited:
 *   • search_brain — pure scoped retrieval; the HOST's model synthesizes (cheap).
 *   • ask_brain    — comb's own generator produces a grounded answer.
 * Plus ingest (write) and list_sources (provenance).
 *
 * Transport is stdio, so it registers exactly like knit/gbrain:
 *   "open-company-brain": { "command": "npx", "args": ["-y", "open-company-brain", "mcp"] }
 *
 * IMPORTANT: stdout is the protocol channel — never write to it. The brain logs
 * to stderr; we keep stdout clean for MCP frames only.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Brain } from '../brain/brain.js';
import { config, describeMode } from '../config.js';

/** Resolve caller scopes: explicit arg → MCP_SCOPES env → demo default. */
function resolveScopes(arg?: string): string[] {
  const fromArg = (arg ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fromArg.length) return fromArg;
  const fromEnv = (process.env.MCP_SCOPES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  return [config.demoUserAccessScope];
}

export async function createMcpServer(): Promise<McpServer> {
  const brain = await Brain.create();
  const server = new McpServer({ name: 'open-company-brain', version: '0.4.0' });

  // ── search_brain: governed retrieval, host synthesizes ──────────────────────
  server.tool(
    'search_brain',
    'Search the company brain for grounded, access-scoped knowledge. Returns the most relevant records with their provenance (source) and similarity score, so YOUR agent can cite them. Use this to ground an answer before responding.',
    {
      query: z.string().describe('What to look for (a question or topic).'),
      scopes: z.string().optional().describe('Comma-separated access scopes; defaults to the configured scope.'),
    },
    async ({ query, scopes }) => {
      const chunks = await brain.search(query, resolveScopes(scopes));
      if (chunks.length === 0) {
        return { content: [{ type: 'text', text: 'No matching records in the brain for that query (within the allowed scopes).' }] };
      }
      const text = chunks
        .map((c, i) => `[#${i + 1} source=${c.source} score=${c.score.toFixed(2)}]\n${c.text}`)
        .join('\n\n---\n\n');
      return { content: [{ type: 'text', text }] };
    },
  );

  // ── ask_brain: comb's own grounded, cite-or-refuse agent ────────────
  server.tool(
    'ask_brain',
    "Ask the company brain a question and get a grounded, cited answer produced by the brain's own model. It cites the records it used and refuses if it has no grounding (it never invents).",
    {
      question: z.string().describe('The question to answer from the brain.'),
      scopes: z.string().optional().describe('Comma-separated access scopes; defaults to the configured scope.'),
    },
    async ({ question, scopes }) => {
      const { answer, sources } = await brain.ask(question, resolveScopes(scopes));
      const cites = [...new Set(sources.map((s) => s.source))];
      const suffix = cites.length ? `\n\nSources: ${cites.map((s) => `[${s}]`).join(' ')}` : '';
      return { content: [{ type: 'text', text: `${answer}${suffix}` }] };
    },
  );

  // ── ingest: write new knowledge into the brain ──────────────────────────────
  server.tool(
    'ingest',
    'Add knowledge to the company brain (text, CSV, or JSON). It becomes scoped, embedded, retrievable knowledge that every door can ground on, and triggers any configured fan-out agents.',
    {
      content: z.string().describe('The data to ingest.'),
      format: z.enum(['text', 'csv', 'json']).optional().describe('Defaults to text.'),
      source: z.string().optional().describe('Provenance label shown on citations (e.g. "meeting-notes").'),
      scope: z.string().optional().describe('Access scope to store under; must be one the caller holds.'),
    },
    async ({ content, format, source, scope }) => {
      const scopes = resolveScopes(scope);
      const r = await brain.ingest({ format: format ?? 'text', content, source, scope }, scopes);
      const reacted = r.reactions.length ? ` ${r.reactions.length} fan-out agent(s) reacted.` : '';
      return { content: [{ type: 'text', text: `Ingested ${r.ingested} record(s) as "${r.source}" under scope "${r.scope}".${reacted}` }] };
    },
  );

  // ── list_sources: provenance the caller can see ─────────────────────────────
  server.tool(
    'list_sources',
    'List the provenance sources currently in the brain (within the allowed scopes), with how many records each holds.',
    { scopes: z.string().optional().describe('Comma-separated access scopes; defaults to the configured scope.') },
    async ({ scopes }) => {
      const stats = await brain.knowledgeStats(resolveScopes(scopes));
      if (stats.length === 0) return { content: [{ type: 'text', text: 'The brain is empty (within the allowed scopes).' }] };
      const text = stats.map((s) => `- ${s.source}: ${s.count}`).join('\n');
      return { content: [{ type: 'text', text: `Sources:\n${text}` }] };
    },
  );

  return server;
}

/** Entry point for `comb mcp` (stdio). */
export async function runMcpStdio(): Promise<void> {
  const server = await createMcpServer();
  // Status line on stderr so it never pollutes the stdio protocol channel.
  process.stderr.write(`open-company-brain MCP server ready (${describeMode()})\n`);
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMcpStdio().catch((err: unknown) => {
    process.stderr.write(`✗ MCP server failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
