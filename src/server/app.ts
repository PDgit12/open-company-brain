/**
 * HTTP API — the surface your webapp calls.
 *
 * Read endpoints:
 *   GET  /health                  status + active mode
 *   POST /api/ask                 { question }           → grounded answer + sources
 *   POST /api/ask/stream          { question }           → SSE token stream
 *   GET  /api/health-check        attention agent (what needs follow-up)
 *   GET  /api/stats               real per-source document counts (scope-filtered)
 *
 * Data in (dashboard "Connect data" + the workflow webhook):
 *   POST /api/ingest              { format, content, source?, scope? } → embeds into recall
 *
 * Learning loop:
 *   POST /api/feedback            { query, answer, verdict, sources? } → records a verdict
 *   GET  /api/eval/candidates     auto-grown regression cases (scope-gated review queue)
 *
 * Custom agents (no-code):
 *   POST /api/agents/run          { instruction, query }   → grounded, cited answer
 *   GET  /api/agents              list saved agent definitions
 *   POST /api/agents              { name, instruction, query? } → save a reusable agent
 *
 * Fan-out (event-driven agents — run automatically on each ingest):
 *   GET  /api/fanout/agents       list reaction agents
 *   POST /api/fanout/agents       { name, instruction, scope?, enabled? } → add one
 *   GET  /api/fanout/results      cited outputs reactions produced (scope-filtered)
 *
 * Write endpoints (action layer — human-approved):
 *   POST /api/actions/propose          { title, instruction, query } → proposed action
 *   POST /api/actions/:id/approve      → executes (idempotent)
 *   POST /api/actions/:id/reject       { reason? }
 *   GET  /api/actions                  list proposed/executed actions
 *   GET  /api/actions/audit            the audit log
 *
 * ACCESS SCOPES: callers send `x-access-scopes: scopeA,scopeB`. The brain only
 * ever returns chunks within those scopes. The demo falls back to one scope.
 *
 * WRITE AUTH: when INGEST_API_KEY is set, POST /api/ingest and POST
 * /api/fanout/agents require it (Authorization: Bearer … or x-api-key) and the
 * caller is granted INGEST_SCOPES (the workflow path). Unset = open (dev/mock).
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { Brain } from '../brain/brain.js';
import { IngestBodySchema } from '../brain/ingest.js';
import { ActionService } from '../actions/service.js';
import { getCustomAgentStore } from '../agents/registry.js';
import { getReactionAgentStore } from '../fanout/registry.js';
import { getFanoutResultStore } from '../fanout/engine.js';
import { ingestAuth, type AuthedRequest } from './auth.js';
import { readConfig, writeConfig } from '../config/settings.js';
import { NO_MODEL_MESSAGE } from '../agents/generator.js';
import { config, describeMode } from '../config.js';
import { logger } from '../observability/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const AskBody = z.object({ question: z.string().trim().min(1) });
const ActionProposeBody = z.object({
  title: z.string().trim().min(1),
  instruction: z.string().trim().min(1),
  query: z.string().trim().min(1),
  idempotencyKey: z.string().trim().optional(),
});
const FeedbackBody = z.object({
  query: z.string().trim().min(1),
  answer: z.string().trim().min(1),
  verdict: z.enum(['approved', 'rejected', 'helpful', 'unhelpful']),
  // Echo back the `source` of each chunk from the answer so the reranker can
  // attribute the verdict to the records that grounded it.
  sources: z.array(z.string()).optional(),
});
const AgentRunBody = z.object({
  instruction: z.string().trim().min(1),
  query: z.string().trim().min(1),
});
const AgentSaveBody = z.object({
  name: z.string().trim().min(1),
  instruction: z.string().trim().min(1),
  query: z.string().trim().optional(),
});
const ReactionSaveBody = z.object({
  name: z.string().trim().min(1),
  instruction: z.string().trim().min(1),
  scope: z.string().trim().optional(),
  enabled: z.boolean().optional(),
});

/**
 * Wrap an async route so a rejected promise is forwarded to the error handler
 * instead of becoming an unhandled rejection that crashes the process. Without
 * this, a recall/generation provider outage takes the whole server down.
 */
export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/** Parse caller access scopes from the request (governance). */
function callerScopes(req: Request): string[] {
  // An API-key-authenticated (machine/workflow) caller is granted INGEST_SCOPES
  // by the ingestAuth middleware; those win over a client-supplied header.
  const injected = (req as AuthedRequest).ingestScopes;
  if (injected && injected.length) return injected;
  const header = req.header('x-access-scopes');
  if (header) {
    const scopes = header.split(',').map((s) => s.trim()).filter(Boolean);
    if (scopes.length) return scopes;
  }
  return [config.demoUserAccessScope];
}

export async function createApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());

  // Observability: structured request log with duration.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.request(req.method, req.path, res.statusCode, ms);
    });
    next();
  });

  app.use(express.static(PUBLIC_DIR));

  const brain = await Brain.create();
  const actions = ActionService.create(brain);
  const agents = getCustomAgentStore();
  const reactions = getReactionAgentStore();
  const fanoutResults = getFanoutResultStore();

  app.get('/health', (_req, res) => res.json({ status: 'ok', mode: describeMode() }));

  app.post('/api/ask', asyncRoute(async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'question is required' });
    // No real model → don't fabricate. Point to search + the connected agent.
    if (!config.generationEnabled) return res.json({ answer: NO_MODEL_MESSAGE, sources: [], modelFree: true });
    return res.json(await brain.ask(parsed.data.question, callerScopes(req)));
  }));

  // Model-free retrieval — the honest default for the webapp: returns the cited
  // records (no generation), exactly like the MCP search_brain tool. This works
  // with NO model; the connected agent (or the user) reads the cited results.
  app.post('/api/search', asyncRoute(async (req, res) => {
    const query = typeof (req.body as { query?: unknown })?.query === 'string' ? (req.body as { query: string }).query : '';
    if (!query.trim()) return res.status(400).json({ error: 'query is required' });
    const chunks = await brain.search(query, callerScopes(req));
    return res.json({ query, results: chunks.map((c) => ({ text: c.text, source: c.source, score: c.score })) });
  }));

  // Streaming answer over Server-Sent Events. Streams the grounded answer in
  // chunks; live token-by-token streaming via Langbase stream:true is a
  // documented upgrade in the generator.
  app.post('/api/ask/stream', asyncRoute(async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'question is required' });
    if (!config.generationEnabled) return res.json({ answer: NO_MODEL_MESSAGE, sources: [], modelFree: true });
    // Generate BEFORE opening the SSE stream, so a generation error returns a
    // clean 500 via the error handler instead of a half-written stream.
    const { answer, sources } = await brain.ask(parsed.data.question, callerScopes(req));
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    for (const token of answer.match(/\S+\s*/g) ?? [answer]) {
      res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`);
    }
    res.write(`event: done\ndata: ${JSON.stringify({ sources })}\n\n`);
    return res.end();
  }));

  app.get('/api/health-check', asyncRoute(async (req, res) => {
    return res.json(await brain.health(callerScopes(req)));
  }));

  // Real per-source counts the caller can see — the dashboard renders these
  // directly so the knowledge viz reflects the brain, never a fabricated number.
  app.get('/api/stats', asyncRoute(async (req, res) => {
    const sources = await brain.knowledgeStats(callerScopes(req));
    const total = sources.reduce((n, s) => n + s.count, 0);
    return res.json({ sources, total });
  }));

  // Data in: paste/upload/push text · CSV · JSON → embedded into recall, scoped
  // to a scope the caller holds. Agents (ask/draft) ground on it instantly.
  app.post('/api/ingest', ingestAuth, asyncRoute(async (req, res) => {
    const parsed = IngestBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'format and content are required' });
    try {
      const result = await brain.ingest(parsed.data, callerScopes(req));
      return res.json({ ok: true, ...result });
    } catch (err) {
      // A malformed CSV/JSON paste or an over-size payload is a 400, not a 500 —
      // the brain itself is fine; the input could not be parsed/accepted.
      return res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Could not ingest.' });
    }
  }));

  // Config: read the current backend/retrieval/keys-set (no secret values) and
  // change them without hand-editing .env. GET is safe (no secrets); POST is a
  // sensitive write (it sets keys) so it carries the same auth as ingest, and
  // takes effect on restart (config is parsed once at boot).
  app.get('/api/config', asyncRoute(async (_req, res) => {
    return res.json(readConfig());
  }));
  app.post('/api/config', ingestAuth, asyncRoute(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'expected an object of settings' });
    const result = await writeConfig(body);
    if (!result.updated.length) {
      return res.status(400).json({ ok: false, error: 'no valid settings to update', rejected: result.rejected });
    }
    return res.json({ ok: true, ...result, note: 'Saved to .env — restart Comb for changes to take effect.' });
  }));

  // Feedback: a thumbs up/down on an answer. Fuels the few-shot + reranker loops.
  app.post('/api/feedback', asyncRoute(async (req, res) => {
    const parsed = FeedbackBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'query, answer, verdict required' });
    const { query, answer, verdict, sources } = parsed.data;
    await brain.recordAnswerFeedback(query, answer, verdict, callerScopes(req), sources);
    return res.json({ ok: true });
  }));

  // Auto-grown eval candidates from rejected answers — a human-review queue
  // (scope-gated). Promote good ones into the curated golden set.
  app.get('/api/eval/candidates', asyncRoute(async (req, res) => {
    return res.json({ candidates: await brain.evalCandidates(callerScopes(req)) });
  }));

  // ── Custom agents (no-code) ────────────────────────────────────────────────
  // A read agent = an instruction + what to retrieve. Run it live (grounded +
  // cited, access-scoped via brain.draft) or save the definition for reuse.

  app.post('/api/agents/run', asyncRoute(async (req, res) => {
    const parsed = AgentRunBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'instruction and query are required' });
    if (!config.generationEnabled) return res.json({ answer: NO_MODEL_MESSAGE, sources: [], modelFree: true });
    const { instruction, query } = parsed.data;
    const { text, sources } = await brain.draft(query, instruction, callerScopes(req));
    return res.json({ answer: text, sources });
  }));

  app.get('/api/agents', asyncRoute(async (_req, res) => {
    return res.json({ agents: await agents.list() });
  }));

  app.post('/api/agents', asyncRoute(async (req, res) => {
    const parsed = AgentSaveBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'name and instruction are required' });
    return res.status(201).json({ agent: await agents.save(parsed.data) });
  }));

  // ── Fan-out (event-driven agents) ──────────────────────────────────────────
  // Reaction agents run automatically over each newly ingested item (see
  // brain.ingest → runReactions). Define them here; read their cited outputs.

  app.get('/api/fanout/agents', asyncRoute(async (_req, res) => {
    return res.json({ agents: await reactions.list() });
  }));

  app.post('/api/fanout/agents', ingestAuth, asyncRoute(async (req, res) => {
    const parsed = ReactionSaveBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'name and instruction are required' });
    return res.status(201).json({ agent: await reactions.save(parsed.data) });
  }));

  app.get('/api/fanout/results', asyncRoute(async (req, res) => {
    return res.json({ results: await fanoutResults.list(callerScopes(req)) });
  }));

  // ── Action layer ──────────────────────────────────────────────────────────

  // Propose a grounded action (a drafted message/summary/payload). Nothing is
  // delivered until a human approves; if the brain can't ground it, it refuses.
  app.post('/api/actions/propose', asyncRoute(async (req, res) => {
    const parsed = ActionProposeBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'title, instruction and query are required' });
    const result = await actions.propose(parsed.data, callerScopes(req));
    return res.status(result.ok ? 200 : 422).json(result);
  }));

  app.post('/api/actions/:id/approve', asyncRoute(async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'action id is required' });
    const result = await actions.approve(id);
    return res.status(result.ok ? 200 : 404).json(result);
  }));

  app.post('/api/actions/:id/reject', asyncRoute(async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'action id is required' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = await actions.reject(id, reason);
    return res.status(result.ok ? 200 : 404).json(result);
  }));

  app.get('/api/actions', asyncRoute(async (_req, res) => res.json({ actions: await actions.list() })));
  app.get('/api/actions/audit', asyncRoute(async (_req, res) => res.json({ audit: await actions.auditLog() })));

  // Central error handler — MUST be last. Any route failure (e.g. the recall or
  // generation provider is down/misconfigured) returns 500 instead of crashing
  // the process. The full error is logged server-side; the client gets a safe message.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error('unhandled_route_error', {
      method: req.method,
      path: req.path,
      err: err instanceof Error ? err.message : String(err),
    });
    if (res.headersSent) return;
    res.status(500).json({ error: 'The brain could not complete this request.' });
  });

  return app;
}
