/**
 * Per-agent conversation memory — context retention across runs and sessions.
 *
 * A saved agent has a stable id, so its conversation can outlive any single
 * `comb run`/`chat` process. This store keeps the turns; the SavedAgent adapter
 * loads the recent ones into its prompt and appends each new exchange. Same
 * three-tier persistence as the registry: in-memory (isolated tests) → file
 * (zero-setup default, durable across processes) → Postgres (when configured).
 *
 * Scope note: memory is keyed by AGENT, not by access scope. Retrieval is still
 * scope-gated at run time (brain.draft enforces it), so remembering the dialogue
 * never widens what knowledge an agent can ground on.
 */

import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';
import { JsonFileCollection } from '../storage/json-file.js';
import { estimateTokens } from '../harness/tokens.js';

export type Role = 'user' | 'assistant';

export interface ConversationTurn {
  role: Role;
  content: string;
  at: string;
}

/** A turn as stored in a flat, multi-agent collection (file/PG). */
interface StoredTurn extends ConversationTurn {
  agentId: string;
}

/** How many recent turns to load into a run's prompt — bounds prompt growth. */
export const DEFAULT_MEMORY_TURNS = 10;

export interface ConversationStore {
  append(agentId: string, turn: ConversationTurn): Promise<void>;
  history(agentId: string, limit?: number): Promise<ConversationTurn[]>;
  clear(agentId: string): Promise<void>;
}

const strip = ({ role, content, at }: StoredTurn): ConversationTurn => ({ role, content, at });
const tail = <T>(xs: T[], limit?: number): T[] => (limit && limit > 0 ? xs.slice(-limit) : xs);

// ─── In-memory (direct tests) ────────────────────────────────────────────────

export class InMemoryConversationStore implements ConversationStore {
  private turns = new Map<string, ConversationTurn[]>();

  async append(agentId: string, turn: ConversationTurn): Promise<void> {
    const list = this.turns.get(agentId) ?? [];
    list.push(turn);
    this.turns.set(agentId, list);
  }

  async history(agentId: string, limit = DEFAULT_MEMORY_TURNS): Promise<ConversationTurn[]> {
    return tail(this.turns.get(agentId) ?? [], limit);
  }

  async clear(agentId: string): Promise<void> {
    this.turns.delete(agentId);
  }
}

// ─── File-backed (zero-setup default) ────────────────────────────────────────

export class FileConversationStore implements ConversationStore {
  private readonly collection: JsonFileCollection<StoredTurn>;

  constructor(dataDir: string) {
    this.collection = new JsonFileCollection<StoredTurn>(
      path.join(dataDir, 'conversations.json'),
    );
  }

  async append(agentId: string, turn: ConversationTurn): Promise<void> {
    await this.collection.append({ agentId, ...turn });
  }

  async history(agentId: string, limit = DEFAULT_MEMORY_TURNS): Promise<ConversationTurn[]> {
    const all = await this.collection.read();
    return tail(all.filter((t) => t.agentId === agentId).map(strip), limit);
  }

  async clear(agentId: string): Promise<void> {
    const all = await this.collection.read();
    await this.collection.write(all.filter((t) => t.agentId !== agentId));
  }
}

// ─── Postgres-backed (when configured) ───────────────────────────────────────

export class PgConversationStore implements ConversationStore {
  private readonly pool: pg.Pool;
  private ready = false;

  constructor(connectionString: string, private readonly table = 'agent_conversations') {
    this.pool = new pg.Pool({ connectionString });
  }

  private async ensure(): Promise<void> {
    if (this.ready) return;
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         seq bigserial PRIMARY KEY,
         agent_id text NOT NULL,
         role text NOT NULL,
         content text NOT NULL,
         at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS ${this.table}_agent_idx ON ${this.table} (agent_id, seq)`,
    );
    this.ready = true;
  }

  async append(agentId: string, turn: ConversationTurn): Promise<void> {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO ${this.table} (agent_id, role, content, at) VALUES ($1, $2, $3, $4)`,
      [agentId, turn.role, turn.content, turn.at],
    );
  }

  async history(agentId: string, limit = DEFAULT_MEMORY_TURNS): Promise<ConversationTurn[]> {
    await this.ensure();
    // Take the most recent `limit` rows, then return them oldest-first.
    const { rows } = await this.pool.query(
      `SELECT role, content, at FROM (
         SELECT role, content, at, seq FROM ${this.table}
          WHERE agent_id = $1 ORDER BY seq DESC LIMIT $2
       ) recent ORDER BY seq ASC`,
      [agentId, limit],
    );
    return rows.map((r: { role: Role; content: string; at: Date | string }) => ({
      role: r.role,
      content: r.content,
      at: typeof r.at === 'string' ? r.at : r.at.toISOString(),
    }));
  }

  async clear(agentId: string): Promise<void> {
    await this.ensure();
    await this.pool.query(`DELETE FROM ${this.table} WHERE agent_id = $1`, [agentId]);
  }
}

let singleton: ConversationStore | null = null;
/** Process-wide conversation store, mirroring the registry's tier resolution. */
export function getConversationStore(): ConversationStore {
  if (!singleton) {
    const pgUrl = config.ollama.vectorDatabaseUrl;
    singleton = pgUrl
      ? new PgConversationStore(pgUrl)
      : new FileConversationStore(config.comb.dataDir);
  }
  return singleton;
}

// ─── Per-agent binding + prompt formatting ───────────────────────────────────

/** A memory view bound to one agent — what the SavedAgent adapter consumes. */
export interface AgentMemory {
  recent(limit?: number): Promise<ConversationTurn[]>;
  remember(user: string, assistant: string): Promise<void>;
}

export function bindMemory(store: ConversationStore, agentId: string): AgentMemory {
  return {
    recent: (limit) => store.history(agentId, limit),
    async remember(user, assistant) {
      const at = new Date().toISOString();
      await store.append(agentId, { role: 'user', content: user, at });
      await store.append(agentId, { role: 'assistant', content: assistant, at: new Date().toISOString() });
    },
  };
}

/**
 * Context-window packing: keep the MOST RECENT turns whose cumulative estimated
 * tokens fit `maxTokens`, dropping oldest first. This is what makes the harness
 * safe on a small context window — memory never grows unbounded into the prompt.
 * Returns turns oldest-first (ready to render), preserving conversational order.
 */
export function fitTurns(turns: ConversationTurn[], maxTokens: number): ConversationTurn[] {
  if (maxTokens <= 0) return [];
  const kept: ConversationTurn[] = [];
  let used = 0;
  // Walk newest → oldest, accumulating until the next turn would overflow.
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTokens(turns[i]!.content) + 8; // +role/label overhead
    if (used + cost > maxTokens) break;
    used += cost;
    kept.push(turns[i]!);
  }
  return kept.reverse();
}

/**
 * Render prior turns as a compact prompt block, trimmed to fit `maxTokens` of
 * the context window (0 = no trim). Empty string when there's nothing to show.
 */
export function formatMemory(turns: ConversationTurn[], maxTokens = 0): string {
  const fitted = maxTokens > 0 ? fitTurns(turns, maxTokens) : turns;
  if (!fitted.length) return '';
  const lines = fitted.map((t) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.content}`);
  return `CONVERSATION SO FAR:\n${lines.join('\n')}`;
}
