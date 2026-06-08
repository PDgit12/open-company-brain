/**
 * Run / trace store — durable observability for agent runs.
 *
 * Every agent run already produces an `AgentResult { output, steps[] }`; the
 * harness just throws it away after printing. This persists each run as a trace
 * — agent, scopes, backend, the full tool-call trace, token counts, and latency
 * — so you can answer "what did this agent actually do, how long did it take,
 * how many tokens did it burn." It's also the substrate evals and the dashboard
 * read from.
 *
 * Same three-tier ladder as the rest of the harness: in-memory (tests) → file
 * (zero-setup default) → Postgres (when configured).
 */

import path from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { config } from '../config.js';
import { JsonFileCollection } from '../storage/json-file.js';
import { estimateTokens } from '../harness/tokens.js';
import { NO_CONTEXT_REPLY } from '../agents/generator.js';
import type { Agent, AgentContext, AgentResult, AgentStep } from '../harness/agent.js';

export interface RunRecord {
  id: string;
  at: string;
  agent: string;
  backend: string;
  scopes: string[];
  input: string;
  output: string;
  steps: AgentStep[];
  promptTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface RunStore {
  append(record: RunRecord): Promise<void>;
  /** Most recent runs, newest first. */
  list(limit?: number): Promise<RunRecord[]>;
  get(id: string): Promise<RunRecord | undefined>;
}

const nextRunId = (): string => `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Failure-shaped classification of a recorded run. We can't know ground truth,
 * so these are REVIEW SIGNALS, not verdicts:
 *   • 'refused'    — the agent declined (cite-or-refuse fired). Legit, OR a
 *                    missed-grounding bug — exactly what's worth promoting.
 *   • 'ungrounded' — it answered with no citation and no tool call (a possible
 *                    hallucination — answered from nothing).
 *   • 'ok'         — answered with grounding/tools.
 * `comb runs --failed` surfaces the non-ok runs for human triage → promotion.
 */
export type RunConcern = 'ok' | 'refused' | 'ungrounded';

export function classifyRun(r: Pick<RunRecord, 'output' | 'steps'>): RunConcern {
  if (r.output.includes(NO_CONTEXT_REPLY)) return 'refused';
  const grounded = /Sources:\s*\[/.test(r.output) || r.steps.length > 0;
  return grounded ? 'ok' : 'ungrounded';
}

/** Build a trace record from a finished run. Token counts use the active tokenizer. */
export function toRecord(
  agent: string,
  scopes: string[],
  input: string,
  result: AgentResult,
  latencyMs: number,
): RunRecord {
  return {
    id: nextRunId(),
    at: new Date().toISOString(),
    agent,
    backend: config.backend,
    scopes,
    input,
    output: result.output,
    steps: result.steps,
    promptTokens: estimateTokens(input),
    outputTokens: estimateTokens(result.output),
    latencyMs: Math.round(latencyMs),
  };
}

// ─── In-memory ───────────────────────────────────────────────────────────────

export class InMemoryRunStore implements RunStore {
  private runs: RunRecord[] = [];
  async append(record: RunRecord): Promise<void> {
    this.runs.push(record);
  }
  async list(limit = 20): Promise<RunRecord[]> {
    return this.runs.slice(-limit).reverse();
  }
  async get(id: string): Promise<RunRecord | undefined> {
    return this.runs.find((r) => r.id === id);
  }
}

// ─── File-backed (zero-setup default) ────────────────────────────────────────

export class FileRunStore implements RunStore {
  private readonly collection: JsonFileCollection<RunRecord>;
  constructor(dataDir: string) {
    this.collection = new JsonFileCollection<RunRecord>(path.join(dataDir, 'runs.json'));
  }
  async append(record: RunRecord): Promise<void> {
    await this.collection.append(record);
  }
  async list(limit = 20): Promise<RunRecord[]> {
    return (await this.collection.read()).slice(-limit).reverse();
  }
  async get(id: string): Promise<RunRecord | undefined> {
    return (await this.collection.read()).find((r) => r.id === id);
  }
}

// ─── Postgres-backed (when configured) ───────────────────────────────────────

export class PgRunStore implements RunStore {
  private readonly pool: pg.Pool;
  private ready = false;
  constructor(connectionString: string, private readonly table = 'agent_runs') {
    this.pool = new pg.Pool({ connectionString });
  }
  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         id text PRIMARY KEY,
         at timestamptz NOT NULL DEFAULT now(),
         agent text NOT NULL,
         backend text NOT NULL,
         scopes text[] NOT NULL DEFAULT '{}',
         input text NOT NULL,
         output text NOT NULL,
         steps jsonb NOT NULL DEFAULT '[]',
         prompt_tokens int NOT NULL DEFAULT 0,
         output_tokens int NOT NULL DEFAULT 0,
         latency_ms int NOT NULL DEFAULT 0
       )`,
    );
    this.ready = true;
  }
  async append(r: RunRecord): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO ${this.table}
         (id, at, agent, backend, scopes, input, output, steps, prompt_tokens, output_tokens, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.id, r.at, r.agent, r.backend, r.scopes, r.input, r.output, JSON.stringify(r.steps), r.promptTokens, r.outputTokens, r.latencyMs],
    );
  }
  async list(limit = 20): Promise<RunRecord[]> {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.table} ORDER BY at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(rowToRecord);
  }
  async get(id: string): Promise<RunRecord | undefined> {
    await this.ensure();
    const { rows } = await this.pool.query(`SELECT * FROM ${this.table} WHERE id = $1`, [id]);
    return rows[0] ? rowToRecord(rows[0]) : undefined;
  }
}

function rowToRecord(r: Record<string, unknown>): RunRecord {
  const at = r.at as Date | string;
  return {
    id: String(r.id),
    at: typeof at === 'string' ? at : at.toISOString(),
    agent: String(r.agent),
    backend: String(r.backend),
    scopes: (r.scopes as string[]) ?? [],
    input: String(r.input),
    output: String(r.output),
    steps: (typeof r.steps === 'string' ? JSON.parse(r.steps) : r.steps) as AgentStep[],
    promptTokens: Number(r.prompt_tokens),
    outputTokens: Number(r.output_tokens),
    latencyMs: Number(r.latency_ms),
  };
}

let singleton: RunStore | null = null;
export function getRunStore(): RunStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl ? new PgRunStore(pgUrl) : new FileRunStore(config.comb.dataDir);
  }
  return singleton;
}

/**
 * Run an agent and persist a trace. Times the call, records the run (best-effort
 * — a trace-store failure must never fail the actual run), and returns the
 * result unchanged. This is the one wrapper the CLI and library share.
 */
export async function tracedRun(
  agent: Agent,
  task: string,
  ctx: AgentContext,
  store: RunStore = getRunStore(),
): Promise<AgentResult> {
  const t0 = performance.now();
  const result = await agent.run(task, ctx);
  const latencyMs = performance.now() - t0;
  try {
    await store.append(toRecord(agent.name, ctx.scopes, task, result, latencyMs));
  } catch {
    // Observability is never allowed to break the run it observes.
  }
  return result;
}
