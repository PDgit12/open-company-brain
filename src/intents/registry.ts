/**
 * Intent registry — first-class records of WHAT SHOULD BE HAPPENING.
 *
 * The closed loop's reference signal (ARCHITECTURE §11.5): an Intent is a
 * scoped, versioned statement of expectation — a sprint goal, a policy, a
 * spec, a procedure commitment. Reality streams are compared AGAINST intents
 * by the divergence engine; a flag always cites the intent it diverged from.
 *
 * Deliberately the same three-tier shape as the agent registry (the pattern's
 * second stamp): in-memory (tests) → JSON file (zero-setup) → Postgres.
 */

import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { JsonFileCollection } from '../storage/json-file.js';

export type IntentKind = 'goal' | 'spec' | 'policy' | 'procedure';

export interface Intent {
  id: string;
  /** The expectation, stated plainly: "Sprint 14 ships the export API". */
  statement: string;
  kind: IntentKind;
  /** Scopes whose reality this intent governs (and who may see flags). */
  scopes: string[];
  enabled: boolean;
  version: number;
  createdAt: string;
}

export interface SaveIntentInput {
  statement: string;
  kind?: IntentKind;
  scopes?: string[];
}

export interface IntentStore {
  save(input: SaveIntentInput): Promise<Intent>;
  list(scopes?: string[]): Promise<Intent[]>;
  get(id: string): Promise<Intent | undefined>;
  update(id: string, patch: Partial<Omit<Intent, 'id' | 'createdAt'>>): Promise<Intent | undefined>;
}

const nextId = (): string =>
  `intent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function toIntent(input: SaveIntentInput): Intent {
  return {
    id: nextId(),
    statement: input.statement.trim(),
    kind: input.kind ?? 'goal',
    scopes: input.scopes?.length ? input.scopes : [config.demoUserAccessScope],
    enabled: true,
    version: 1,
    createdAt: new Date().toISOString(),
  };
}

/** Scope filter: an intent is visible iff the caller holds ANY of its scopes. */
function visible(i: Intent, scopes?: string[]): boolean {
  if (!scopes?.length) return true;
  return i.scopes.some((s) => scopes.includes(s));
}

function patched(i: Intent, patch: Partial<Omit<Intent, 'id' | 'createdAt'>>): Intent {
  return { ...i, ...patch, id: i.id, createdAt: i.createdAt, version: i.version + 1 };
}

export class InMemoryIntentStore implements IntentStore {
  private intents: Intent[] = [];
  async save(input: SaveIntentInput): Promise<Intent> {
    const it = toIntent(input);
    this.intents.push(it);
    return it;
  }
  async list(scopes?: string[]): Promise<Intent[]> {
    return this.intents.filter((i) => visible(i, scopes));
  }
  async get(id: string): Promise<Intent | undefined> {
    return this.intents.find((i) => i.id === id);
  }
  async update(id: string, patch: Partial<Omit<Intent, 'id' | 'createdAt'>>): Promise<Intent | undefined> {
    const idx = this.intents.findIndex((i) => i.id === id);
    if (idx === -1) return undefined;
    this.intents[idx] = patched(this.intents[idx]!, patch);
    return this.intents[idx];
  }
}

export class FileIntentStore implements IntentStore {
  private readonly collection: JsonFileCollection<Intent>;
  constructor(dataDir: string) {
    this.collection = new JsonFileCollection<Intent>(path.join(dataDir, 'intents.json'));
  }
  async save(input: SaveIntentInput): Promise<Intent> {
    const it = toIntent(input);
    await this.collection.append(it);
    return it;
  }
  async list(scopes?: string[]): Promise<Intent[]> {
    return (await this.collection.read()).filter((i) => visible(i, scopes));
  }
  async get(id: string): Promise<Intent | undefined> {
    return (await this.collection.read()).find((i) => i.id === id);
  }
  async update(id: string, patch: Partial<Omit<Intent, 'id' | 'createdAt'>>): Promise<Intent | undefined> {
    const all = await this.collection.read();
    const idx = all.findIndex((i) => i.id === id);
    if (idx === -1) return undefined;
    all[idx] = patched(all[idx]!, patch);
    await this.collection.write(all);
    return all[idx];
  }
}

export class PgIntentStore implements IntentStore {
  private readonly pool: pg.Pool;
  private ready = false;
  constructor(connectionString: string, private readonly table = 'intents') {
    this.pool = new pg.Pool({ connectionString });
  }
  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         statement text NOT NULL,
         kind text NOT NULL,
         scopes text[] NOT NULL DEFAULT '{}',
         enabled boolean NOT NULL DEFAULT true,
         version int NOT NULL DEFAULT 1,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    this.ready = true;
  }
  async save(input: SaveIntentInput): Promise<Intent> {
    await this.ensure();
    const it = toIntent(input);
    await this.pool.query(
      `INSERT INTO ${this.table} (id, statement, kind, scopes, enabled, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [it.id, it.statement, it.kind, it.scopes, it.enabled, it.version, it.createdAt],
    );
    return it;
  }
  async list(scopes?: string[]): Promise<Intent[]> {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT * FROM ${this.table} ORDER BY created_at ASC`);
    return rows
      .map((r: Record<string, unknown>) => ({
        id: String(r.id),
        statement: String(r.statement),
        kind: r.kind as IntentKind,
        scopes: (r.scopes as string[]) ?? [],
        enabled: Boolean(r.enabled),
        version: Number(r.version),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      }))
      .filter((i) => visible(i, scopes));
  }
  async get(id: string): Promise<Intent | undefined> {
    return (await this.list()).find((i) => i.id === id);
  }
  async update(id: string, patch: Partial<Omit<Intent, 'id' | 'createdAt'>>): Promise<Intent | undefined> {
    await this.ensure();
    const current = await this.get(id);
    if (!current) return undefined;
    const next = patched(current, patch);
    await this.pool.query(
      `UPDATE ${this.table} SET statement=$2, kind=$3, scopes=$4, enabled=$5, version=$6 WHERE id=$1`,
      [id, next.statement, next.kind, next.scopes, next.enabled, next.version],
    );
    return next;
  }
}

let singleton: IntentStore | null = null;
export function getIntentStore(): IntentStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl ? new PgIntentStore(pgUrl) : new FileIntentStore(config.comb.dataDir);
  }
  return singleton;
}
