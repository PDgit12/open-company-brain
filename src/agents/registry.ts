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

export interface CustomAgent {
  id: string;
  name: string;
  /** The instruction the model follows (the user's prompt). */
  instruction: string;
  /** What to retrieve for grounding (defaults to the run-time question). */
  query: string;
  createdAt: string;
}

export interface SaveAgentInput {
  name: string;
  instruction: string;
  query?: string;
}

export interface CustomAgentStore {
  save(input: SaveAgentInput): Promise<CustomAgent>;
  list(): Promise<CustomAgent[]>;
  get(id: string): Promise<CustomAgent | undefined>;
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
  return {
    id,
    name: input.name.trim(),
    instruction: input.instruction.trim(),
    query: (input.query ?? input.name).trim(),
    createdAt,
  };
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
    return [...this.agents];
  }

  async get(id: string): Promise<CustomAgent | undefined> {
    return this.agents.find((a) => a.id === id);
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
    return this.collection.read();
  }

  async get(id: string): Promise<CustomAgent | undefined> {
    return (await this.collection.read()).find((a) => a.id === id);
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
    this.ready = true;
  }

  async save(input: SaveAgentInput): Promise<CustomAgent> {
    await this.ensure();
    const agent = toAgent(input, nextId(), new Date().toISOString());
    await this.pool.query(
      `INSERT INTO ${this.table} (id, name, instruction, query, created_at) VALUES ($1, $2, $3, $4, $5)`,
      [agent.id, agent.name, agent.instruction, agent.query, agent.createdAt],
    );
    return agent;
  }

  async list(): Promise<CustomAgent[]> {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT id, name, instruction, query, created_at FROM ${this.table} ORDER BY created_at ASC`,
    );
    return rows.map((r: { id: string; name: string; instruction: string; query: string; created_at: Date | string }) => ({
      id: r.id, name: r.name, instruction: r.instruction, query: r.query,
      createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
    }));
  }

  async get(id: string): Promise<CustomAgent | undefined> {
    return (await this.list()).find((a) => a.id === id);
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
