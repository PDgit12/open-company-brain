/**
 * The fan-out engine — run reaction agents over newly ingested data.
 *
 * On every successful ingest, `runReactions` takes the new content as a retrieval
 * query and applies each enabled reaction agent's instruction through the SAME
 * grounded, cite-or-refuse path as every other agent (`brain.draft`). The cited
 * outputs are stored so the dashboard (and your workflow) can read what the
 * agents concluded as data streamed in.
 *
 * Scope safety: a reaction runs under `agent.scope ?? ingestScope`, and a scoped
 * agent only fires on ingests in its own scope — so a fan-out result can never be
 * grounded on, or surface, data outside the agent's access scope.
 */

import pg from 'pg';
import { config } from '../config.js';
import { getReactionAgentStore } from './registry.js';
import type { Brain } from '../brain/brain.js';

export interface FanoutResult {
  id: string;
  agentId: string;
  agentName: string;
  /** Provenance of the data that triggered this reaction. */
  source: string;
  /** Access scope the reaction ran under (also the scope this result is visible in). */
  scope: string;
  answer: string;
  sources: Array<{ text: string; source: string }>;
  at: string;
}

export interface FanoutResultStore {
  record(result: FanoutResult): Promise<void>;
  /** Results visible to a caller holding `scopes` (scope-gated, newest first). */
  list(scopes: string[]): Promise<FanoutResult[]>;
}

let resultCounter = 0;
const nextResultId = (): string => `fr_${++resultCounter}_${process.pid}`;

export class InMemoryFanoutResultStore implements FanoutResultStore {
  private results: FanoutResult[] = [];

  async record(result: FanoutResult): Promise<void> {
    this.results.push(result);
  }

  async list(scopes: string[]): Promise<FanoutResult[]> {
    const allowed = new Set(scopes);
    return this.results
      .filter((r) => allowed.has(r.scope))
      .sort((a, b) => b.at.localeCompare(a.at));
  }
}

/** Postgres-backed result store — fan-out outputs survive restarts (lazy-ensure). */
export class PgFanoutResultStore implements FanoutResultStore {
  private readonly pool: pg.Pool;
  private ready = false;

  constructor(connectionString: string, private readonly table = 'fanout_results') {
    this.pool = new pg.Pool({ connectionString });
  }

  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         agent_id text NOT NULL,
         agent_name text NOT NULL,
         source text NOT NULL,
         scope text NOT NULL,
         answer text NOT NULL,
         sources jsonb NOT NULL,
         at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    this.ready = true;
  }

  async record(result: FanoutResult): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO ${this.table} (id, agent_id, agent_name, source, scope, answer, sources, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [result.id, result.agentId, result.agentName, result.source, result.scope, result.answer, JSON.stringify(result.sources), result.at],
    );
  }

  async list(scopes: string[]): Promise<FanoutResult[]> {
    await this.ensure();
    if (scopes.length === 0) return [];
    const { rows } = await this.pool.query(
      `SELECT id, agent_id, agent_name, source, scope, answer, sources, at
       FROM ${this.table} WHERE scope = ANY($1) ORDER BY at DESC LIMIT 200`,
      [scopes],
    );
    return rows.map((r: {
      id: string; agent_id: string; agent_name: string; source: string; scope: string;
      answer: string; sources: unknown; at: Date | string;
    }) => ({
      id: r.id,
      agentId: r.agent_id,
      agentName: r.agent_name,
      source: r.source,
      scope: r.scope,
      answer: r.answer,
      sources: (typeof r.sources === 'string' ? JSON.parse(r.sources) : r.sources) as FanoutResult['sources'],
      at: typeof r.at === 'string' ? r.at : r.at.toISOString(),
    }));
  }
}

let singleton: FanoutResultStore | null = null;
export function getFanoutResultStore(): FanoutResultStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl ? new PgFanoutResultStore(pgUrl) : new InMemoryFanoutResultStore();
  }
  return singleton;
}

/** Test seam: reset the process singleton between cases. */
export function resetFanoutResultStore(): void {
  singleton = null;
}

export interface IngestEvent {
  /** Provenance label of the data just ingested. */
  source: string;
  /** Access scope the data was ingested under. */
  scope: string;
  /** The ingested text, used to retrieve the just-added records for grounding. */
  query: string;
}

/**
 * Run all enabled reaction agents against a just-ingested item. Returns the cited
 * results (also persisted). A no-op — and zero generations — when no reaction
 * agents are configured. Awaitable so callers (and tests) can observe the output;
 * the HTTP route awaits it too, but an empty registry keeps that effectively free.
 */
export async function runReactions(brain: Brain, event: IngestEvent): Promise<FanoutResult[]> {
  const agents = (await getReactionAgentStore().list()).filter((a) => a.enabled);
  if (agents.length === 0) return [];

  const store = getFanoutResultStore();
  const results: FanoutResult[] = [];
  for (const agent of agents) {
    const runScope = agent.scope ?? event.scope;
    // A scoped agent only reacts to data in its own scope; an unscoped agent
    // reacts to every ingest under that ingest's scope.
    if (runScope !== event.scope) continue;
    // Each reaction runs through the grounded, cite-or-refuse path.
    const { text, sources } = await brain.draft(event.query, agent.instruction, [runScope]);
    const result: FanoutResult = {
      id: nextResultId(),
      agentId: agent.id,
      agentName: agent.name,
      source: event.source,
      scope: runScope,
      answer: text,
      sources: sources.map((s) => ({ text: s.text, source: s.source })),
      at: new Date().toISOString(),
    };
    await store.record(result);
    results.push(result);
  }
  return results;
}
