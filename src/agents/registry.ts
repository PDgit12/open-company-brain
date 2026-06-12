/**
 * Custom agents — no-code, runtime-defined agents.
 *
 * A "read agent" is just an instruction (a prompt) plus what to retrieve. The
 * Brain already exposes that shape via `draft(query, instruction, scopes)`:
 * retrieve grounded chunks, then generate under the instruction. So a user can
 * define and run an agent from the dashboard with zero code — and it inherits
 * citations and the cite-or-refuse contract for free.
 *
 * This store holds the *definitions* (name + instruction + retrieval query).
 * It is deliberately the same in-memory-default + process-singleton shape as the
 * feedback store, so it works in mock mode with zero setup and swaps to a
 * Postgres-backed impl later. Definitions are prompt templates, not records —
 * the access boundary is enforced when an agent RUNS (Brain.draft is scoped).
 */

import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { JsonFileCollection } from '../storage/json-file.js';

/** The autonomy dial position — EARNED per agent, never global. */
export type AutonomyLevel = 'L0' | 'L1' | 'L2';

export interface CustomAgent {
  id: string;
  name: string;
  /** The instruction the model follows (the user's prompt). */
  instruction: string;
  /** What to retrieve for grounding (defaults to the run-time question). */
  query: string;
  createdAt: string;
  // ── v2 lifecycle fields (legacy rows normalized via withDefaults) ─────────
  /** Definition version — bumped on update. */
  version: number;
  /** Fabric tool ids this agent MAY call. Default: brain tools only. */
  toolGrants: string[];
  /** 'answer' = prose AnswerRecord; a JSON-schema string = machine contract. */
  outputContract: string;
  /** L0 inform · L1 draft+human-approve · L2 policy-approve (rate-capped). */
  autonomy: AutonomyLevel;
  /** Benched agents don't run. */
  enabled: boolean;
  /**
   * COMMISSIONED = passed its birth-kit starter evals ("born tested").
   * v2-created agents start false and must pass `comb commission`; legacy
   * rows (pre-v2) normalize to true so nothing already deployed breaks.
   */
  commissioned: boolean;
}

export interface SaveAgentInput {
  name: string;
  instruction: string;
  query?: string;
  /** v2 creation paths set false to require commissioning; default true (legacy). */
  commissioned?: boolean;
}

/** Normalize a (possibly legacy) row to the v2 shape — defaults defined ONCE. */
export function withDefaults(a: Partial<CustomAgent> & Pick<CustomAgent, 'id' | 'name' | 'instruction' | 'query' | 'createdAt'>): CustomAgent {
  return {
    version: 1,
    toolGrants: ['brain.*'],
    outputContract: 'answer',
    autonomy: 'L1',
    enabled: true,
    commissioned: true, // legacy rows predate the gate — grandfathered
    ...a,
  };
}

export interface CustomAgentStore {
  save(input: SaveAgentInput): Promise<CustomAgent>;
  list(): Promise<CustomAgent[]>;
  get(id: string): Promise<CustomAgent | undefined>;
  /** Patch v2 lifecycle fields (commissioned/enabled/autonomy/…); bumps version. */
  update(id: string, patch: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>): Promise<CustomAgent | undefined>;
}

/**
 * Resolve a saved agent by id OR (case-insensitive) name. The CLI takes either,
 * so a human can type `comb run --saved "Risk scan"` without copying an id.
 * Shared by every store impl, so the lookup rule is defined exactly once.
 */
export async function resolveAgent(
  store: CustomAgentStore,
  idOrName: string,
): Promise<CustomAgent | undefined> {
  const needle = idOrName.trim();
  const byId = await store.get(needle);
  if (byId) return byId;
  const lower = needle.toLowerCase();
  return (await store.list()).find((a) => a.name.toLowerCase() === lower);
}

function toAgent(input: SaveAgentInput, id: string, createdAt: string): CustomAgent {
  return withDefaults({
    id,
    name: input.name.trim(),
    instruction: input.instruction.trim(),
    query: (input.query ?? input.name).trim(),
    createdAt,
    ...(input.commissioned === undefined ? {} : { commissioned: input.commissioned }),
  });
}

/** Apply a patch immutably and bump the version. */
function applyPatch(a: CustomAgent, patch: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>): CustomAgent {
  return withDefaults({ ...a, ...patch, id: a.id, createdAt: a.createdAt, version: (a.version ?? 1) + 1 });
}

// Process-safe id: a saved agent written by one `comb create` run must not
// collide with one written by another. Time + randomness, not a process counter.
const nextId = (): string =>
  `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class InMemoryCustomAgentStore implements CustomAgentStore {
  private agents: CustomAgent[] = [];

  async save(input: SaveAgentInput): Promise<CustomAgent> {
    const agent = toAgent(input, nextId(), new Date().toISOString());
    this.agents.push(agent);
    return agent;
  }

  async list(): Promise<CustomAgent[]> {
    return this.agents.map(withDefaults);
  }

  async get(id: string): Promise<CustomAgent | undefined> {
    const a = this.agents.find((x) => x.id === id);
    return a ? withDefaults(a) : undefined;
  }

  async update(id: string, patch: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>): Promise<CustomAgent | undefined> {
    const i = this.agents.findIndex((x) => x.id === id);
    if (i === -1) return undefined;
    const next = applyPatch(withDefaults(this.agents[i]!), patch);
    this.agents[i] = next;
    return next;
  }
}

/**
 * File-backed registry — the zero-setup persistence default. Saved agents live
 * in one JSON file under the data dir, so `comb create` survives a process exit
 * with no database. Mirrors the action-delivery `file` sink philosophy.
 */
export class FileCustomAgentStore implements CustomAgentStore {
  private readonly collection: JsonFileCollection<CustomAgent>;

  constructor(dataDir: string) {
    this.collection = new JsonFileCollection<CustomAgent>(path.join(dataDir, 'agents.json'));
  }

  async save(input: SaveAgentInput): Promise<CustomAgent> {
    const agent = toAgent(input, nextId(), new Date().toISOString());
    await this.collection.append(agent);
    return agent;
  }

  async list(): Promise<CustomAgent[]> {
    return (await this.collection.read()).map(withDefaults);
  }

  async get(id: string): Promise<CustomAgent | undefined> {
    const a = (await this.collection.read()).find((x) => x.id === id);
    return a ? withDefaults(a) : undefined;
  }

  async update(id: string, patch: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>): Promise<CustomAgent | undefined> {
    const all = await this.collection.read();
    const i = all.findIndex((x) => x.id === id);
    if (i === -1) return undefined;
    const next = applyPatch(withDefaults(all[i]!), patch);
    all[i] = next;
    await this.collection.write(all);
    return next;
  }
}

/**
 * Postgres-backed registry — saved agents survive restarts. Same lazy-ensure
 * shape as PgVectorMemoryStore: the table is created on first use, so there is
 * no migration step for the zero-setup story.
 */
export class PgCustomAgentStore implements CustomAgentStore {
  private readonly pool: pg.Pool;
  private ready = false;

  constructor(connectionString: string, private readonly table = 'custom_agents') {
    this.pool = new pg.Pool({ connectionString });
  }

  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         name text NOT NULL,
         instruction text NOT NULL,
         query text NOT NULL,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    // v2: lifecycle fields live in one jsonb column — legacy rows get NULL
    // and normalize through withDefaults on read (grandfathered commissioned).
    await this.pool.query(`ALTER TABLE ${this.table} ADD COLUMN IF NOT EXISTS lifecycle jsonb`);
    this.ready = true;
  }

  private static lifecycleOf(a: CustomAgent): Record<string, unknown> {
    const { version, toolGrants, outputContract, autonomy, enabled, commissioned } = a;
    return { version, toolGrants, outputContract, autonomy, enabled, commissioned };
  }

  async save(input: SaveAgentInput): Promise<CustomAgent> {
    await this.ensure();
    const agent = toAgent(input, nextId(), new Date().toISOString());
    await this.pool.query(
      `INSERT INTO ${this.table} (id, name, instruction, query, created_at, lifecycle) VALUES ($1, $2, $3, $4, $5, $6)`,
      [agent.id, agent.name, agent.instruction, agent.query, agent.createdAt, JSON.stringify(PgCustomAgentStore.lifecycleOf(agent))],
    );
    return agent;
  }

  async list(): Promise<CustomAgent[]> {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT id, name, instruction, query, created_at, lifecycle FROM ${this.table} ORDER BY created_at ASC`,
    );
    return rows.map((r: { id: string; name: string; instruction: string; query: string; created_at: Date | string; lifecycle: Record<string, unknown> | null }) =>
      withDefaults({
        id: r.id, name: r.name, instruction: r.instruction, query: r.query,
        createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
        ...(r.lifecycle ?? {}),
      }),
    );
  }

  async get(id: string): Promise<CustomAgent | undefined> {
    return (await this.list()).find((a) => a.id === id);
  }

  async update(id: string, patch: Partial<Omit<CustomAgent, 'id' | 'createdAt'>>): Promise<CustomAgent | undefined> {
    await this.ensure();
    const current = await this.get(id);
    if (!current) return undefined;
    const next = applyPatch(current, patch);
    await this.pool.query(
      `UPDATE ${this.table} SET name=$2, instruction=$3, query=$4, lifecycle=$5 WHERE id=$1`,
      [id, next.name, next.instruction, next.query, JSON.stringify(PgCustomAgentStore.lifecycleOf(next))],
    );
    return next;
  }
}

let singleton: CustomAgentStore | null = null;
/**
 * Process-wide store so the API, the dashboard, and the CLI share one registry.
 * Postgres when a connection string is configured (local or Langbase+PG); else
 * the file-backed store under the data dir — so saved agents always persist,
 * even in zero-setup mock mode. (InMemory remains for direct, isolated tests.)
 */
export function getCustomAgentStore(): CustomAgentStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl
      ? new PgCustomAgentStore(pgUrl)
      : new FileCustomAgentStore(config.comb.dataDir);
  }
  return singleton;
}
