/**
 * Reaction agents — the fan-out registry.
 *
 * A reaction agent is an instruction that runs AUTOMATICALLY over each new piece
 * of data the moment it is ingested (e.g. "extract action items", "flag risks",
 * "summarize for leadership"). This is what turns the brain from a passive store
 * into an active one: connect a workflow (n8n) to the ingest webhook, and every
 * record that lands fans out to the agents you configured — grounded and cited.
 *
 * The registry is EMPTY by default. Fan-out is opt-in per agent, so a cold brain
 * does zero extra generation on ingest (a cost guard, and deterministic tests).
 *
 * Same in-memory-default + process-singleton + lazy-ensure-Postgres shape as the
 * custom-agent registry, so it works in mock mode with zero setup and persists
 * when a Postgres connection is configured.
 */

import pg from 'pg';
import { config } from '../config.js';

export interface ReactionAgent {
  id: string;
  name: string;
  /** The instruction applied to each newly ingested item. */
  instruction: string;
  /**
   * Access scope this agent reacts within. When set, it only fires on ingests in
   * that scope and runs under it. When omitted, it reacts to every ingest under
   * that ingest's own scope.
   */
  scope?: string;
  enabled: boolean;
  createdAt: string;
}

export interface ReactionAgentInput {
  name: string;
  instruction: string;
  scope?: string;
  enabled?: boolean;
}

export interface ReactionAgentStore {
  save(input: ReactionAgentInput): Promise<ReactionAgent>;
  list(): Promise<ReactionAgent[]>;
}

let counter = 0;
const nextId = (): string => `reaction_${++counter}_${process.pid}`;

function toAgent(input: ReactionAgentInput, id: string, createdAt: string): ReactionAgent {
  return {
    id,
    name: input.name.trim(),
    instruction: input.instruction.trim(),
    ...(input.scope?.trim() ? { scope: input.scope.trim() } : {}),
    enabled: input.enabled ?? true,
    createdAt,
  };
}

export class InMemoryReactionAgentStore implements ReactionAgentStore {
  private agents: ReactionAgent[] = [];

  async save(input: ReactionAgentInput): Promise<ReactionAgent> {
    const agent = toAgent(input, nextId(), new Date().toISOString());
    this.agents.push(agent);
    return agent;
  }

  async list(): Promise<ReactionAgent[]> {
    return [...this.agents];
  }
}

/** Postgres-backed registry — reaction agents survive restarts (lazy-ensure). */
export class PgReactionAgentStore implements ReactionAgentStore {
  private readonly pool: pg.Pool;
  private ready = false;

  constructor(connectionString: string, private readonly table = 'reaction_agents') {
    this.pool = new pg.Pool({ connectionString });
  }

  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         name text NOT NULL,
         instruction text NOT NULL,
         scope text,
         enabled boolean NOT NULL DEFAULT true,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    this.ready = true;
  }

  async save(input: ReactionAgentInput): Promise<ReactionAgent> {
    await this.ensure();
    const agent = toAgent(input, nextId(), new Date().toISOString());
    await this.pool.query(
      `INSERT INTO ${this.table} (id, name, instruction, scope, enabled, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [agent.id, agent.name, agent.instruction, agent.scope ?? null, agent.enabled, agent.createdAt],
    );
    return agent;
  }

  async list(): Promise<ReactionAgent[]> {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT id, name, instruction, scope, enabled, created_at FROM ${this.table} ORDER BY created_at ASC`,
    );
    return rows.map(
      (r: { id: string; name: string; instruction: string; scope: string | null; enabled: boolean; created_at: Date | string }) => ({
        id: r.id,
        name: r.name,
        instruction: r.instruction,
        ...(r.scope ? { scope: r.scope } : {}),
        enabled: r.enabled,
        createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
      }),
    );
  }
}

let singleton: ReactionAgentStore | null = null;
/** Process-wide store so the API, the dashboard, and the library share one registry. */
export function getReactionAgentStore(): ReactionAgentStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl ? new PgReactionAgentStore(pgUrl) : new InMemoryReactionAgentStore();
  }
  return singleton;
}

/** Test seam: reset the process singleton between cases. */
export function resetReactionAgentStore(): void {
  singleton = null;
}
