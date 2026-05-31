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

import pg from 'pg';
import { config } from '../config.js';

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

function toAgent(input: SaveAgentInput, id: string, createdAt: string): CustomAgent {
  return {
    id,
    name: input.name.trim(),
    instruction: input.instruction.trim(),
    query: (input.query ?? input.name).trim(),
    createdAt,
  };
}

let counter = 0;
const nextId = (): string => `agent_${++counter}_${process.pid}`;

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
 * Process-wide store so the API and the dashboard share one registry.
 * Uses Postgres when a connection string is configured (local or Langbase+PG),
 * so saved agents persist; falls back to in-memory in zero-setup mock mode.
 */
export function getCustomAgentStore(): CustomAgentStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl ? new PgCustomAgentStore(pgUrl) : new InMemoryCustomAgentStore();
  }
  return singleton;
}
