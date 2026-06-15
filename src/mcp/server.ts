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

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Brain } from '../brain/brain.js';
import { config, describeMode } from '../config.js';
import { ActionService } from '../actions/service.js';
import { getIntentStore, type IntentKind } from '../intents/registry.js';
import { listCandidates } from '../divergence/engine.js';
import { getSkillStore } from '../skills/registry.js';
import { ServingOptimizer } from '../optimizer/serving.js';
import { getRunStore, classifyRun } from '../observability/runs.js';

/**
 * PRINCIPAL: who this connection IS. Each MCP host registers comb with its own
 * env (MCP_PRINCIPAL + MCP_SCOPES), so attribution is per-connection — the
 * accountability unit behind every write/act/prove call (scopes authorize;
 * the principal attributes).
 */
function principalName(): string {
  return (process.env.MCP_PRINCIPAL ?? '').trim() || 'unnamed-agent';
}

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
  const actions = ActionService.create(brain);
  // Single source of truth for the version: read package.json at runtime
  // (createRequire avoids the rootDir:src compile constraint on a static import,
  // and package.json ships with the package, so dist/mcp → ../../package.json).
  const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };
  const server = new McpServer({ name: 'open-company-brain', version });

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
      // CCR serving optimizer: compress + dedup against this session's manifest
      // + cache-align, so the host never re-pays for context it already has.
      const opt = await new ServingOptimizer(principalName()).serve(
        chunks.map((c) => ({ text: c.text, source: c.source })),
      );
      return { content: [{ type: 'text', text: opt.text }] };
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
      // Honest gate: ask_brain is Comb's OWN generation. On the model-free
      // default (no model) it can't deliver that — so say so and point to the
      // intended flow (search_brain + the host's model) instead of returning a
      // confusing template that looks like a real answer.
      if (config.backend === 'mock') {
        return {
          content: [
            {
              type: 'text',
              text: 'ask_brain needs a generation model, which is not configured on this model-free setup. Use search_brain instead and write the answer yourself from the cited records — that is the intended model-free flow. (To enable ask_brain, set LLM_BACKEND=local or openai.)',
            },
          ],
        };
      }
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

  // ── ACT: propose an action (enters the human/policy approval queue) ─────────
  server.tool(
    'propose_action',
    'Propose a real-world action (a notice, an update, a reply). The draft is GROUNDED in the brain (refused if no grounding) and enters the approval queue — a human (or rate-capped policy at L2) must approve before anything executes. Returns the action id to check status.',
    {
      title: z.string().describe('Short label, e.g. "Notify managers about policy change".'),
      instruction: z.string().describe('What to draft (the trust contract applies).'),
      query: z.string().describe('What to retrieve from the brain to ground the draft.'),
      scopes: z.string().optional().describe('Comma-separated access scopes.'),
    },
    async ({ title, instruction, query, scopes }) => {
      const r = await actions.propose({ title, instruction, query, by: principalName() }, resolveScopes(scopes));
      if (!r.ok) return { content: [{ type: 'text', text: `REFUSED: ${r.reason}` }] };
      return { content: [{ type: 'text', text: `Proposed (${r.action.status}): id=${r.action.id}\nDraft:\n${r.action.body.slice(0, 800)}` }] };
    },
  );

  // ── ACT: check an action's status ────────────────────────────────────────────
  server.tool(
    'action_status',
    'Check the status of a proposed action (proposed | executed | rejected | failed) and its effect.',
    { id: z.string().describe('The action id returned by propose_action.') },
    async ({ id }) => {
      const all = await actions.list();
      const a = all.find((x) => x.id === id) ?? all.find((x) => x.id.startsWith(id));
      if (!a) return { content: [{ type: 'text', text: `No action ${id}.` }] };
      const outcome = a.outcome ? ` · outcome: ${a.outcome}` : '';
      return { content: [{ type: 'text', text: `${a.title}: ${a.status}${a.effect ? ` — ${a.effect}` : ''}${outcome}` }] };
    },
  );

  // ── SIGNAL: report the real-world outcome of a delivered action ─────────────
  server.tool(
    'record_outcome',
    "Report what ACTUALLY happened after an executed action landed in the world — did it get a reply, convert, get ignored, error, or have to be reverted. This is the Signal rung: it feeds the brain's reward currency, so the records that grounded a winning action rank higher next time and a losing one demotes them. Use it once you know the result; only works on an executed action.",
    {
      id: z.string().describe('The action id (from propose_action / submit_action).'),
      outcome: z.enum(['replied', 'converted', 'ignored', 'error', 'reverted']).describe('What happened after delivery.'),
      evidence: z.string().optional().describe('Optional note, e.g. "manager replied: approved".'),
      scopes: z.string().optional().describe('Scopes the action lived in (so the reward is gated correctly).'),
    },
    async ({ id, outcome, evidence, scopes }) => {
      const r = await actions.recordOutcome({ id, outcome, evidence, scopes: resolveScopes(scopes) });
      if (!r.ok) return { content: [{ type: 'text', text: `Could not record outcome: ${r.reason}` }] };
      return { content: [{ type: 'text', text: `Recorded outcome "${outcome}" for ${r.action.title} (reward ${r.reward}). The loop adjusted: grounding sources re-weighted.` }] };
    },
  );

  // ── COMPARE: divergence candidates for the HOST to judge (model-free) ───────
  server.tool(
    'list_divergence_candidates',
    "New reality that OVERLAPS a declared intent (model-free keyword detection) — YOU judge whether each is a real divergence from how things should be. If it is, draft an alert with submit_action. Comb detects candidates; you do the reasoning.",
    { scope: z.string().optional() },
    async ({ scope }) => {
      const cands = await listCandidates(scope ? resolveScopes(scope)[0] : undefined);
      if (!cands.length) return { content: [{ type: 'text', text: 'No open divergence candidates.' }] };
      const text = cands
        .map((c) => `• intent: ${c.intentStatement}\n  reality (${c.source}): ${c.evidence.slice(0, 200)}\n  overlap: ${(c.overlap * 100).toFixed(0)}%`)
        .join('\n\n');
      return { content: [{ type: 'text', text }] };
    },
  );

  // ── PROVE: query recent runs (the receipts) ──────────────────────────────────
  server.tool(
    'query_runs',
    "Query the brain's recent agent runs — the audit/observability trail: status (answered/refused/memory), tokens, latency, concern classification. Use to verify what the system actually did.",
    { limit: z.number().optional().describe('How many recent runs (default 10).') },
    async ({ limit }) => {
      const runs = await getRunStore().list(limit ?? 10);
      if (!runs.length) return { content: [{ type: 'text', text: 'No runs recorded yet.' }] };
      const text = runs
        .map((r) => `- ${r.id} [${classifyRun(r)}] ${r.agent} · "${r.input.slice(0, 50)}" · ${r.promptTokens}+${r.outputTokens} tok · ${r.latencyMs}ms`)
        .join('\n');
      return { content: [{ type: 'text', text }] };
    },
  );

  // ── WRITE: record a SKILL — how work is done (host-structured, model-free) ──
  server.tool(
    'record_skill',
    "Record a SKILL — HOW something is done at this company (e.g. how a refund is handled, how a pricing exception is decided). YOU (the host agent) structure it from the source; Comb stores and serves it by trigger match. This is the company's executable 'how-to' map.",
    {
      name: z.string().describe('Short name, e.g. "Handle a refund request".'),
      body: z.string().describe('The procedure: steps, decision rules, approvals, exceptions.'),
      triggers: z.string().optional().describe('Comma-separated keywords that should surface this skill.'),
      scopes: z.string().optional(),
    },
    async ({ name, body, triggers, scopes }) => {
      const sk = await getSkillStore().save({
        name, body,
        triggers: triggers ? triggers.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        scopes: resolveScopes(scopes),
      });
      return { content: [{ type: 'text', text: `Skill ${sk.id} recorded by ${principalName()} (triggers: ${sk.triggers.join(', ')}).` }] };
    },
  );
  server.tool(
    'find_skill',
    'Find how-to SKILLS relevant to a task by trigger match (e.g. "customer wants a refund"). Returns the procedures; YOU follow them. Model-free, scoped.',
    { query: z.string(), scopes: z.string().optional() },
    async ({ query, scopes }) => {
      const hits = await getSkillStore().find(query, resolveScopes(scopes));
      if (!hits.length) return { content: [{ type: 'text', text: `No skill recorded for "${query}".` }] };
      // ONE batched write for all hits (was k sequential read+write cycles).
      await getSkillStore().bumpUsesMany(hits.map((h) => h.id));
      return { content: [{ type: 'text', text: hits.map((s) => `## ${s.name}\n${s.body}`).join('\n\n') }] };
    },
  );

  // ── WRITE: record a structured FACT (host-structured knowledge) ─────────────
  server.tool(
    'record_fact',
    'Record a structured fact into the brain (scoped, retrievable). Use when you extract a discrete fact from a source. For bulk/raw text use `ingest` instead.',
    { text: z.string(), source: z.string().optional(), scope: z.string().optional() },
    async ({ text, source, scope }) => {
      const scopes = resolveScopes(scope);
      const r = await brain.ingest({ format: 'text', content: text, source: source ?? 'recorded', scope }, scopes);
      return { content: [{ type: 'text', text: `Recorded ${r.ingested} fact(s) under "${r.source}" / scope "${r.scope}".` }] };
    },
  );

  // ── ACT: submit a HOST-DRAFTED action (Comb governs; Comb does NOT draft) ───
  server.tool(
    'submit_action',
    'Submit an action YOU have drafted for governed approval. Comb does NOT generate it — you provide the title and body; Comb queues it for human (or policy) approval, then executes + delivers + audits. Use for any real-world side effect (a notice, an update, a reply).',
    {
      title: z.string().describe('Short label.'),
      body: z.string().describe('The full drafted content you want approved and sent.'),
      sources: z.string().optional().describe('Comma-separated source labels you grounded this on (from search_brain). Carrying them lets record_outcome later re-weight exactly those records — this is what makes the loop compound.'),
      scopes: z.string().optional(),
    },
    async ({ title, body, sources }) => {
      // Carry the host's grounding sources so a later record_outcome can reward
      // the exact records that produced this action (the Adapt->Compound wire).
      const refs = (sources ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((source) => ({ text: '', source }));
      const r = await actions.proposeDirect({ title, body, sources: refs, by: principalName() });
      return { content: [{ type: 'text', text: r.ok ? `Submitted (${r.action.status}): id=${r.action.id} — awaits approval (comb actions).` : `Rejected: ${r.reason}` }] };
    },
  );

  // ── INTENT: declare/list what SHOULD be happening (the loop's reference) ────
  server.tool(
    'declare_intent',
    'Declare an INTENT — what SHOULD be happening (a sprint goal, spec, policy, or procedure). The divergence engine compares reality against intents; flags always cite the intent they diverged from.',
    {
      statement: z.string().describe('The expectation, plainly: "Sprint 14 ships the export API".'),
      kind: z.enum(['goal', 'spec', 'policy', 'procedure']).optional().describe('Defaults to goal.'),
      scopes: z.string().optional().describe('Comma-separated scopes this governs.'),
    },
    async ({ statement, kind, scopes }) => {
      const it = await getIntentStore().save({ statement, kind: kind as IntentKind | undefined, scopes: resolveScopes(scopes) });
      return { content: [{ type: 'text', text: `Intent ${it.id} (${it.kind}, v${it.version}) declared by ${principalName()}.` }] };
    },
  );
  server.tool(
    'list_intents',
    'List declared intents (what SHOULD be happening) visible to the caller scopes.',
    { scopes: z.string().optional() },
    async ({ scopes }) => {
      const all = await getIntentStore().list(resolveScopes(scopes));
      if (!all.length) return { content: [{ type: 'text', text: 'No intents declared.' }] };
      return { content: [{ type: 'text', text: all.map((i) => `- ${i.id} [${i.kind} v${i.version}${i.enabled ? '' : ' disabled'}] ${i.statement}`).join('\n') }] };
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
