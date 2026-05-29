/**
 * Where proposed actions and the audit log live.
 *
 * InMemoryActionStore (default) keeps everything in process — perfect for the
 * demo and tests. PostgresActionStore persists to `actions` / `action_audit`
 * tables for real deployments. Both honour the same interface so nothing
 * downstream cares which is in use.
 */

import pg from 'pg';
import { config } from '../config.js';
import type { ProposedAction, AuditEntry } from './types.js';

export interface ActionStore {
  save(action: ProposedAction): Promise<void>;
  get(id: string): Promise<ProposedAction | null>;
  update(action: ProposedAction): Promise<void>;
  list(): Promise<ProposedAction[]>;
  appendAudit(entry: AuditEntry): Promise<void>;
  audit(): Promise<AuditEntry[]>;
}

export class InMemoryActionStore implements ActionStore {
  private actions = new Map<string, ProposedAction>();
  private auditLog: AuditEntry[] = [];

  async save(action: ProposedAction): Promise<void> {
    this.actions.set(action.id, structuredClone(action));
  }
  async get(id: string): Promise<ProposedAction | null> {
    const a = this.actions.get(id);
    return a ? structuredClone(a) : null;
  }
  async update(action: ProposedAction): Promise<void> {
    this.actions.set(action.id, structuredClone(action));
  }
  async list(): Promise<ProposedAction[]> {
    return [...this.actions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async appendAudit(entry: AuditEntry): Promise<void> {
    this.auditLog.push(entry);
  }
  async audit(): Promise<AuditEntry[]> {
    return [...this.auditLog];
  }
}

export class PostgresActionStore implements ActionStore {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }
  async save(a: ProposedAction): Promise<void> {
    await this.pool.query(
      `INSERT INTO actions (id, kind, company, company_id, payload, sources, status, idempotency_key, created_at, decided_at, executed_at, effect)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [a.id, a.kind, a.company, a.companyId, JSON.stringify(a.payload), JSON.stringify(a.sources),
       a.status, a.idempotencyKey, a.createdAt, a.decidedAt ?? null, a.executedAt ?? null, a.effect ?? null],
    );
  }
  async get(id: string): Promise<ProposedAction | null> {
    const r = await this.pool.query(`SELECT * FROM actions WHERE id = $1`, [id]);
    const row = r.rows[0];
    return row ? rowToAction(row) : null;
  }
  async update(a: ProposedAction): Promise<void> {
    await this.pool.query(
      `UPDATE actions SET status=$2, decided_at=$3, executed_at=$4, effect=$5 WHERE id=$1`,
      [a.id, a.status, a.decidedAt ?? null, a.executedAt ?? null, a.effect ?? null],
    );
  }
  async list(): Promise<ProposedAction[]> {
    const r = await this.pool.query(`SELECT * FROM actions ORDER BY created_at DESC LIMIT 200`);
    return r.rows.map(rowToAction);
  }
  async appendAudit(e: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO action_audit (at, action_id, event, detail) VALUES ($1,$2,$3,$4)`,
      [e.at, e.actionId, e.event, e.detail],
    );
  }
  async audit(): Promise<AuditEntry[]> {
    const r = await this.pool.query(`SELECT at, action_id, event, detail FROM action_audit ORDER BY at`);
    return r.rows.map((row) => ({
      at: typeof row.at === 'string' ? row.at : new Date(row.at).toISOString(),
      actionId: row.action_id,
      event: row.event,
      detail: row.detail,
    }));
  }
}

function rowToAction(row: Record<string, unknown>): ProposedAction {
  const parse = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
  const iso = (v: unknown): string =>
    typeof v === 'string' ? v : new Date(v as string).toISOString();
  return {
    id: row.id as string,
    kind: row.kind as ProposedAction['kind'],
    company: row.company as string,
    companyId: (row.company_id as string) ?? null,
    payload: parse(row.payload),
    sources: parse(row.sources),
    status: row.status as ProposedAction['status'],
    idempotencyKey: row.idempotency_key as string,
    createdAt: iso(row.created_at),
    ...(row.decided_at ? { decidedAt: iso(row.decided_at) } : {}),
    ...(row.executed_at ? { executedAt: iso(row.executed_at) } : {}),
    ...(row.effect ? { effect: row.effect as string } : {}),
  };
}

export function createActionStore(): ActionStore {
  if (config.dataMode === 'postgres' && config.database.url) {
    return new PostgresActionStore(config.database.url);
  }
  return new InMemoryActionStore();
}
