/**
 * Skill store — "HOW work is done here" as a first-class, model-free primitive.
 *
 * Blomfield's "executable skills file": how refunds get handled, how pricing
 * exceptions are decided, how engineers respond to incidents. A skill is a
 * named procedure with trigger keywords and a body — retrieved by TRIGGER
 * MATCH, no embeddings, no model (knitbrain's exact shape). The HOST agent
 * records skills as it structures artifacts; Comb stores, scopes, and serves.
 *
 * Same three-tier ladder as every store: in-memory (tests) → JSON file
 * (zero-setup) → Postgres. Retrieval is deterministic: tokenize the query,
 * score skills by trigger-overlap, return the best within scope.
 */

import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { JsonFileCollection } from '../storage/json-file.js';

export interface Skill {
  id: string;
  /** Short name: "Handle a refund request". */
  name: string;
  /** Keywords that surface this skill (matched against a query). */
  triggers: string[];
  /** The procedure: steps, decision rules, approvals, exceptions. */
  body: string;
  /** Scopes that may see/use this skill. */
  scopes: string[];
  /** Times retrieved — usage signal (a skill nobody uses is a candidate to prune). */
  uses: number;
  version: number;
  updatedAt: string;
}

export interface SaveSkillInput {
  name: string;
  body: string;
  triggers?: string[];
  scopes?: string[];
}

export interface SkillStore {
  save(input: SaveSkillInput): Promise<Skill>;
  /** Trigger-matched retrieval within scope (best first). limit defaults to 5. */
  find(query: string, scopes: string[], limit?: number): Promise<Skill[]>;
  list(scopes?: string[]): Promise<Skill[]>;
  get(id: string): Promise<Skill | undefined>;
  bumpUses(id: string): Promise<void>;
  /** Increment usage for many skills in ONE read+write (file) / ONE UPDATE (pg). */
  bumpUsesMany(ids: string[]): Promise<void>;
}

const nextId = (): string => `skill_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Lowercase word tokens ≥ 3 chars — the trigger-match vocabulary. */
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3);
}

/** Derive triggers from the name when the caller didn't supply them. */
function deriveTriggers(input: SaveSkillInput): string[] {
  const given = (input.triggers ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  return given.length ? [...new Set(given)] : [...new Set(tokens(input.name))];
}

function toSkill(input: SaveSkillInput): Skill {
  return {
    id: nextId(),
    name: input.name.trim(),
    triggers: deriveTriggers(input),
    body: input.body.trim(),
    scopes: input.scopes?.length ? input.scopes : [config.demoUserAccessScope],
    uses: 0,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

const visible = (s: Skill, scopes: string[]): boolean => s.scopes.some((sc) => scopes.includes(sc));

/** Trigger-overlap score: how many query tokens hit the skill's triggers. */
export function scoreSkill(skill: Skill, queryTokens: Set<string>): number {
  const triggerSet = new Set(skill.triggers.flatMap((t) => tokens(t)));
  let hits = 0;
  for (const t of queryTokens) if (triggerSet.has(t)) hits++;
  return queryTokens.size ? hits / queryTokens.size : 0;
}

/** Shared find logic over an in-memory array (file/pg load then call this). */
export function findIn(skills: Skill[], query: string, scopes: string[], limit = 5): Skill[] {
  const q = new Set(tokens(query));
  return skills
    .filter((s) => visible(s, scopes))
    .map((s) => ({ s, score: scoreSkill(s, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

export class InMemorySkillStore implements SkillStore {
  private skills: Skill[] = [];
  async save(input: SaveSkillInput): Promise<Skill> {
    const sk = toSkill(input);
    this.skills.push(sk);
    return sk;
  }
  async find(query: string, scopes: string[], limit = 5): Promise<Skill[]> {
    return findIn(this.skills, query, scopes, limit);
  }
  async list(scopes?: string[]): Promise<Skill[]> {
    return scopes ? this.skills.filter((s) => visible(s, scopes)) : [...this.skills];
  }
  async get(id: string): Promise<Skill | undefined> {
    return this.skills.find((s) => s.id === id);
  }
  async bumpUses(id: string): Promise<void> {
    const s = this.skills.find((x) => x.id === id);
    if (s) s.uses += 1;
  }
  async bumpUsesMany(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const set = new Set(ids);
    for (const s of this.skills) if (set.has(s.id)) s.uses += 1;
  }
}

export class FileSkillStore implements SkillStore {
  private readonly collection: JsonFileCollection<Skill>;
  constructor(dataDir: string) {
    this.collection = new JsonFileCollection<Skill>(path.join(dataDir, 'skills.json'));
  }
  async save(input: SaveSkillInput): Promise<Skill> {
    const sk = toSkill(input);
    await this.collection.append(sk);
    return sk;
  }
  async find(query: string, scopes: string[], limit = 5): Promise<Skill[]> {
    return findIn(await this.collection.read(), query, scopes, limit);
  }
  async list(scopes?: string[]): Promise<Skill[]> {
    const all = await this.collection.read();
    return scopes ? all.filter((s) => visible(s, scopes)) : all;
  }
  async get(id: string): Promise<Skill | undefined> {
    return (await this.collection.read()).find((s) => s.id === id);
  }
  async bumpUses(id: string): Promise<void> {
    await this.bumpUsesMany([id]);
  }
  async bumpUsesMany(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const set = new Set(ids);
    const all = await this.collection.read();
    let changed = false;
    for (const s of all) if (set.has(s.id)) { s.uses += 1; changed = true; }
    if (changed) await this.collection.write(all); // ONE write for all hits (was k writes)
  }
}

export class PgSkillStore implements SkillStore {
  private readonly pool: pg.Pool;
  private ready = false;
  constructor(connectionString: string, private readonly table = 'skills') {
    this.pool = new pg.Pool({ connectionString });
  }
  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         name text NOT NULL,
         triggers text[] NOT NULL DEFAULT '{}',
         body text NOT NULL,
         scopes text[] NOT NULL DEFAULT '{}',
         uses int NOT NULL DEFAULT 0,
         version int NOT NULL DEFAULT 1,
         updated_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    this.ready = true;
  }
  private async all(): Promise<Skill[]> {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT * FROM ${this.table}`);
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      name: String(r.name),
      triggers: (r.triggers as string[]) ?? [],
      body: String(r.body),
      scopes: (r.scopes as string[]) ?? [],
      uses: Number(r.uses),
      version: Number(r.version),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));
  }
  async save(input: SaveSkillInput): Promise<Skill> {
    await this.ensure();
    const sk = toSkill(input);
    await this.pool.query(
      `INSERT INTO ${this.table} (id, name, triggers, body, scopes, uses, version, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sk.id, sk.name, sk.triggers, sk.body, sk.scopes, sk.uses, sk.version, sk.updatedAt],
    );
    return sk;
  }
  async find(query: string, scopes: string[], limit = 5): Promise<Skill[]> {
    return findIn(await this.all(), query, scopes, limit);
  }
  async list(scopes?: string[]): Promise<Skill[]> {
    const all = await this.all();
    return scopes ? all.filter((s) => visible(s, scopes)) : all;
  }
  async get(id: string): Promise<Skill | undefined> {
    return (await this.all()).find((s) => s.id === id);
  }
  async bumpUses(id: string): Promise<void> {
    await this.bumpUsesMany([id]);
  }
  async bumpUsesMany(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.ensure();
    await this.pool.query(`UPDATE ${this.table} SET uses = uses + 1 WHERE id = ANY($1)`, [ids]);
  }
}

let singleton: SkillStore | null = null;
export function getSkillStore(): SkillStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl ? new PgSkillStore(pgUrl) : new FileSkillStore(config.comb.dataDir);
  }
  return singleton;
}
