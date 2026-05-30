/**
 * JSON connector — ingest a single snapshot.json into a BrainSnapshot.
 *
 * The file is the BrainSnapshot shape (companies, contacts, engagements,
 * programs, companyPrograms). Missing arrays default to empty. Useful for
 * exports from another system, or a quick hand-authored dataset. No keys needed.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { BrainSnapshot } from '../domain/types.js';
import type { BrainDataSource } from '../db/datasource.js';

const nowIso = (): string => new Date().toISOString();

const Company = z.object({
  id: z.string(),
  name: z.string(),
  industry: z.string().nullable().default(null),
  partnershipTier: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  access: z.string().default('default-team'),
  updatedAt: z.string().default(nowIso),
});
const Contact = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  title: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  access: z.string().default('default-team'),
  updatedAt: z.string().default(nowIso),
});
const Engagement = z.object({
  id: z.string(),
  companyId: z.string(),
  kind: z.string().default('note'),
  date: z.string(),
  summary: z.string(),
  openActions: z.string().nullable().default(null),
  access: z.string().default('default-team'),
  updatedAt: z.string().default(nowIso),
});
const Program = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  access: z.string().default('default-team'),
  updatedAt: z.string().default(nowIso),
});
const Link = z.object({ companyId: z.string(), programId: z.string() });

const Snapshot = z.object({
  companies: z.array(Company).default([]),
  contacts: z.array(Contact).default([]),
  engagements: z.array(Engagement).default([]),
  programs: z.array(Program).default([]),
  companyPrograms: z.array(Link).default([]),
});

export class JsonConnector implements BrainDataSource {
  constructor(private readonly file: string) {}

  async loadSnapshot(): Promise<BrainSnapshot> {
    const raw = await readFile(this.file, 'utf8');
    return Snapshot.parse(JSON.parse(raw));
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
