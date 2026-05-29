/**
 * HTTP API — the surface your Next.js webapp calls.
 *
 * Endpoints:
 *   GET  /health             — liveness + current mode
 *   GET  /api/companies      — names the brain knows (for autocomplete)
 *   POST /api/brief          — { company }            → grounded briefing + sources
 *   POST /api/ask            — { question }           → grounded answer + sources
 *   POST /api/intro-path     — { from, to }           → relationship path
 *   GET  /                   — the clickable demo page (served from /public)
 *
 * Access scope: this demo uses a single configured scope. In production you pass
 * the caller's real scopes (from your auth layer) into brain.brief/ask instead.
 */

import express, { type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { Brain } from '../brain/brain.js';
import { config, describeMode } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const BriefBody = z.object({ company: z.string().trim().min(1) });
const AskBody = z.object({ question: z.string().trim().min(1) });
const PathBody = z.object({ from: z.string().trim().min(1), to: z.string().trim().min(1) });

export async function createApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // Build the brain once at boot and reuse it across requests.
  const brain = await Brain.create();
  const scopes = [config.demoUserAccessScope];

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', mode: describeMode() });
  });

  app.get('/api/companies', (_req: Request, res: Response) => {
    res.json({ companies: brain.companyNames() });
  });

  app.post('/api/brief', async (req: Request, res: Response) => {
    const parsed = BriefBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'company is required' });
    const result = await brain.brief(parsed.data.company, scopes);
    return res.json(result);
  });

  app.post('/api/ask', async (req: Request, res: Response) => {
    const parsed = AskBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'question is required' });
    const result = await brain.ask(parsed.data.question, scopes);
    return res.json(result);
  });

  app.post('/api/intro-path', (req: Request, res: Response) => {
    const parsed = PathBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'from and to are required' });
    const path = brain.introPath(parsed.data.from, parsed.data.to);
    return res.json({ path });
  });

  return app;
}
