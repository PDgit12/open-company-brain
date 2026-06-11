/**
 * Where proposed actions and the audit log live.
 *
 * The approval queue is the human-in-the-loop gate — the most consequential
 * state in the system — so on any non-mock backend it is FILE-BACKED: pending
 * approvals and the audit trail survive a server restart, and the operator CLI
 * (`comb actions` / `comb approve`) shares the same queue from another process.
 * Mock keeps the in-process store (demo + hermetic tests, ephemeral by design).
 */

import path from 'node:path';
import { config } from '../config.js';
import { JsonFileCollection } from '../storage/json-file.js';
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

/**
 * Durable approval queue on the data-dir ladder. Reads hit the file each call,
 * so the server and the operator CLI see one queue across processes.
 */
export class FileActionStore implements ActionStore {
  private readonly actions: JsonFileCollection<ProposedAction>;
  private readonly auditLog: JsonFileCollection<AuditEntry>;

  constructor(dataDir: string) {
    this.actions = new JsonFileCollection<ProposedAction>(path.join(dataDir, 'actions.json'));
    this.auditLog = new JsonFileCollection<AuditEntry>(path.join(dataDir, 'action-audit.json'));
  }

  async save(action: ProposedAction): Promise<void> {
    await this.actions.append(action);
  }
  async get(id: string): Promise<ProposedAction | null> {
    return (await this.actions.read()).find((a) => a.id === id) ?? null;
  }
  async update(action: ProposedAction): Promise<void> {
    const all = await this.actions.read();
    await this.actions.write(all.map((a) => (a.id === action.id ? action : a)));
  }
  async list(): Promise<ProposedAction[]> {
    return (await this.actions.read()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.auditLog.append(entry);
  }
  async audit(): Promise<AuditEntry[]> {
    return this.auditLog.read();
  }
}

export function createActionStore(): ActionStore {
  // Mock = single-process demo/tests → ephemeral. Anything real → durable file
  // queue so approvals survive restarts and the CLI shares the server's queue.
  return config.backend === 'mock'
    ? new InMemoryActionStore()
    : new FileActionStore(config.comb.dataDir);
}
