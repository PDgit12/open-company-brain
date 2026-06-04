/**
 * Where proposed actions and the audit log live.
 *
 * Actions are transient review items — proposed, then approved or rejected by a
 * human — so the in-process store is the default and is all the demo, the tests,
 * and most deployments need. (Durable, restart-surviving state in this framework
 * is the knowledge itself — see the pgvector memory store — and saved agents.)
 */

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

export function createActionStore(): ActionStore {
  return new InMemoryActionStore();
}
