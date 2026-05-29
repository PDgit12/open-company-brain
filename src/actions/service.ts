/**
 * ActionService — the lifecycle of a write-action.
 *
 *   propose → (human) approve | reject → execute (idempotent) → audit
 *
 * Safety properties live HERE, not in the executor:
 *   • Nothing executes without approve().
 *   • approve() is idempotent: a second approve on an executed action is a
 *     no-op that returns the original outcome (no double-send).
 *   • Every transition is written to the audit log.
 *   • A draft is only proposed if it can be grounded (trust contract).
 */

import { randomUUID } from 'node:crypto';
import type { Brain } from '../brain/brain.js';
import { buildEmailDraftPrompt } from '../agents/prompts.js';
import { createActionStore, type ActionStore } from './store.js';
import { createActionExecutor, type ActionExecutor } from './executor.js';
import type {
  ProposedAction,
  ProposeResult,
  DecisionResult,
  EmailPayload,
  EngagementPayload,
  AuditEvent,
} from './types.js';

const nowIso = (): string => new Date().toISOString();

export interface EngagementInput {
  summary: string;
  kind?: string;
  date?: string;
  openActions?: string | null;
}

export class ActionService {
  constructor(
    private readonly brain: Brain,
    private readonly store: ActionStore,
    private readonly executor: ActionExecutor,
  ) {}

  static create(brain: Brain): ActionService {
    return new ActionService(brain, createActionStore(), createActionExecutor());
  }

  private async log(action: ProposedAction, event: AuditEvent, detail: string): Promise<void> {
    await this.store.appendAudit({ at: nowIso(), actionId: action.id, event, detail });
  }

  async proposeEmail(company: string, goal: string, scopes: string[]): Promise<ProposeResult> {
    // You can't draft to a partner the brain doesn't know — refuse up front.
    const companyId = this.brain.resolveCompanyId(company);
    if (!companyId) {
      return { ok: false, reason: `Unknown company "${company}" — refusing to draft.` };
    }
    const { text, sources } = await this.brain.draft(
      `${company} recent engagements open actions contacts`,
      buildEmailDraftPrompt(company, goal),
      scopes,
    );
    if (sources.length === 0) {
      return { ok: false, reason: `No grounded information about "${company}" — refusing to draft.` };
    }
    const { subject, body } = splitEmail(text, company);
    const payload: EmailPayload = { to: null, subject, body };
    const action: ProposedAction = {
      id: randomUUID(),
      kind: 'draft_email',
      company,
      companyId,
      payload,
      sources: sources.map((s) => ({ text: s.text, source: s.source })),
      status: 'proposed',
      idempotencyKey: `email:${companyId ?? company}:${subject}`,
      createdAt: nowIso(),
    };
    await this.store.save(action);
    await this.log(action, 'proposed', `draft_email for ${company}`);
    return { ok: true, action };
  }

  async proposeEngagement(
    company: string,
    input: EngagementInput,
    _scopes: string[],
  ): Promise<ProposeResult> {
    const companyId = this.brain.resolveCompanyId(company);
    if (!companyId) return { ok: false, reason: `Unknown company "${company}".` };
    if (!input.summary?.trim()) return { ok: false, reason: 'A summary is required.' };

    const payload: EngagementPayload = {
      companyId,
      kind: input.kind?.trim() || 'note',
      date: input.date?.trim() || nowIso().slice(0, 10),
      summary: input.summary.trim(),
      openActions: input.openActions?.trim() || null,
    };
    const action: ProposedAction = {
      id: randomUUID(),
      kind: 'log_engagement',
      company,
      companyId,
      payload,
      sources: [],
      status: 'proposed',
      idempotencyKey: `engagement:${companyId}:${payload.date}:${payload.summary.slice(0, 40)}`,
      createdAt: nowIso(),
    };
    await this.store.save(action);
    await this.log(action, 'proposed', `log_engagement for ${company}`);
    return { ok: true, action };
  }

  async approve(id: string): Promise<DecisionResult> {
    const action = await this.store.get(id);
    if (!action) return { ok: false, reason: 'Action not found.' };

    // Idempotency: already executed → return the original outcome, do NOT re-run.
    if (action.status === 'executed') {
      await this.log(action, 'duplicate-ignored', 'approve called on already-executed action');
      return { ok: true, action };
    }
    if (action.status === 'rejected') return { ok: false, reason: 'Action was rejected.' };
    if (action.status === 'failed') return { ok: false, reason: 'Action previously failed.' };

    await this.log(action, 'approved', 'human approved');
    try {
      const outcome = await this.executor.execute(action);
      const executed: ProposedAction = {
        ...action,
        status: 'executed',
        decidedAt: nowIso(),
        executedAt: nowIso(),
        effect: outcome.effect,
      };
      await this.store.update(executed);
      await this.log(executed, 'executed', outcome.effect);
      return { ok: true, action: executed };
    } catch (err) {
      const failed: ProposedAction = { ...action, status: 'failed', decidedAt: nowIso() };
      await this.store.update(failed);
      await this.log(failed, 'failed', (err as Error).message);
      return { ok: false, reason: `Execution failed: ${(err as Error).message}` };
    }
  }

  async reject(id: string, reason?: string): Promise<DecisionResult> {
    const action = await this.store.get(id);
    if (!action) return { ok: false, reason: 'Action not found.' };
    if (action.status === 'executed') return { ok: false, reason: 'Already executed.' };
    const rejected: ProposedAction = { ...action, status: 'rejected', decidedAt: nowIso() };
    await this.store.update(rejected);
    await this.log(rejected, 'rejected', reason ?? 'human rejected');
    return { ok: true, action: rejected };
  }

  list(): Promise<ProposedAction[]> {
    return this.store.list();
  }
  auditLog(): ReturnType<ActionStore['audit']> {
    return this.store.audit();
  }
}

/** Split a drafted email into subject + body, tolerating a missing Subject line. */
export function splitEmail(text: string, company: string): { subject: string; body: string } {
  const match = text.match(/^\s*subject:\s*(.+)$/im);
  if (match && match[1]) {
    const subject = match[1].trim();
    const body = text.replace(match[0], '').trim();
    return { subject, body };
  }
  return { subject: `Follow-up: ${company}`, body: text.trim() };
}
