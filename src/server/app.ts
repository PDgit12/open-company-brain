/**
 * HTTP API — the surface your webapp calls.
 *
 * Read endpoints (v0):
 *   GET  /health                  status + active mode
 *   GET  /api/companies           known entity names
 *   POST /api/brief               { company }            → grounded briefing + sources
 *   POST /api/ask                 { question }           → grounded answer + sources
 *   POST /api/ask/stream          { question }           → SSE token stream
 *   POST /api/intro-path          { from, to }           → relationship path
 *   GET  /api/health-check        relationship-health agent (what needs attention)
 *
 * Write endpoints (action layer — human-approved):
 *   POST /api/actions/draft-email      { company, goal }            → proposed action
 *   POST /api/actions/log-engagement   { company, summary, ... }    → proposed action
 *   POST /api/actions/:id/approve      → executes (idempotent)
 *   POST /api/actions/:id/reject       { reason? }
 *   GET  /api/actions                  list proposed/executed actions
 *   GET  /api/actions/audit            the audit log
 *
 * ACCESS SCOPES: callers send `x-access-scopes: scopeA,scopeB`. The brain only
 * ever returns chunks within those scopes. The demo falls back to one scope.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { Brain } from '../brain/brain.js';
import { ActionService } from '../actions/service.js';
import { config, describeMode } from '../config.js';
import { logger } from '../observability/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const BriefBody = z.object({ company: z.string().trim().min(1) });
const AskBody = z.object({ question: z.string().trim().min(1) });
const PathBody = z.object({ from: z.string().trim().min(1), to: z.string().trim().min(1) });
const EmailBody = z.object({ company: z.string().trim().min(1), goal: z.string().trim().min(1) });
const EngagementBody = z.object({
  company: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  kind: z.string().trim().optional(),
  date: z.string().trim().optional(),
  openActions: z.string().trim().optional(),
});

/** Parse caller access scopes from the request (governance). */
function callerScopes(req: Request): string[] {
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

  app.get('/health', (_req, res) => res.json({ status: 'ok', mode: describeMode() }));

  app.get('/api/companies', (_req, res) => res.json({ companies: brain.companyNames() }));

  app.post('/api/brief', async (req, res) => {
    const parsed = BriefBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'company is required' });
    return res.json(await brain.brief(parsed.data.company, callerScopes(req)));
  });

  app.post('/api/ask', async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'question is required' });
    return res.json(await brain.ask(parsed.data.question, callerScopes(req)));
  });

  // Streaming answer over Server-Sent Events. Streams the grounded answer in
  // chunks; live token-by-token streaming via Langbase stream:true is a
  // documented upgrade in the generator.
  app.post('/api/ask/stream', async (req, res) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'question is required' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const { answer, sources } = await brain.ask(parsed.data.question, callerScopes(req));
    for (const token of answer.match(/\S+\s*/g) ?? [answer]) {
      res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`);
    }
    res.write(`event: done\ndata: ${JSON.stringify({ sources })}\n\n`);
    return res.end();
  });

  app.post('/api/intro-path', async (req, res) => {
    const parsed = PathBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'from and to are required' });
    const introPath = await brain.introPath(parsed.data.from, parsed.data.to);
    return res.json({ path: introPath });
  });

  app.get('/api/health-check', async (req, res) => {
    return res.json(await brain.health(callerScopes(req)));
  });

  // ── Action layer ──────────────────────────────────────────────────────────

  app.post('/api/actions/draft-email', async (req, res) => {
    const parsed = EmailBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'company and goal are required' });
    const result = await actions.proposeEmail(parsed.data.company, parsed.data.goal, callerScopes(req));
    return res.status(result.ok ? 200 : 422).json(result);
  });

  app.post('/api/actions/log-engagement', async (req, res) => {
    const parsed = EngagementBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'company and summary are required' });
    const { company, ...input } = parsed.data;
    const result = await actions.proposeEngagement(company, input, callerScopes(req));
    return res.status(result.ok ? 200 : 422).json(result);
  });

  app.post('/api/actions/:id/approve', async (req, res) => {
    const result = await actions.approve(req.params.id);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.post('/api/actions/:id/reject', async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = await actions.reject(req.params.id, reason);
    return res.status(result.ok ? 200 : 404).json(result);
  });

  app.get('/api/actions', async (_req, res) => res.json({ actions: await actions.list() }));
  app.get('/api/actions/audit', async (_req, res) => res.json({ audit: await actions.auditLog() }));

  return app;
}
