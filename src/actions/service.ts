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
 *
 * The action itself is universal: any agent can propose a grounded `title` +
 * `body` and a human approves it before the configured delivery sink runs.
 */

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { Brain } from '../brain/brain.js';
import { createActionStore, type ActionStore } from './store.js';
import { createActionExecutor, type ActionExecutor } from './executor.js';
import { getFeedbackStore } from '../feedback/feedback.js';
import type {
  ProposedAction,
  ProposeResult,
  DecisionResult,
  AuditEvent,
} from './types.js';

const nowIso = (): string => new Date().toISOString();

export interface ProposeInput {
  /** Short human label for the action. */
  title: string;
  /** What to draft — the agent instruction (the trust contract still applies). */
  instruction: string;
  /** What to retrieve from the brain to ground the draft. */
  query: string;
  /** Optional stable idempotency key; derived from title+query when absent. */
  idempotencyKey?: string;
  /** Who proposed it (principal name) — lands in the audit trail. */
  by?: string;
}

/** Deterministic FNV-1a hash → stable idempotency suffix. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The autonomy dial, L2: when enabled, a grounded proposal is approved and
 * executed BY POLICY instead of waiting for a human click — bounded by an
 * hourly rate cap so a runaway loop can't fire unbounded side effects. Off by
 * default; turn it on per deployment once eval evidence justifies it.
 */
export interface AutoApprovePolicy {
  enabled: boolean;
  perHour: number;
}

export class ActionService {
  constructor(
    private readonly brain: Brain,
    private readonly store: ActionStore,
    private readonly executor: ActionExecutor,
    private readonly policy: AutoApprovePolicy = { enabled: false, perHour: 20 },
  ) {}

  static create(brain: Brain, policy?: AutoApprovePolicy): ActionService {
    return new ActionService(brain, createActionStore(), createActionExecutor(), policy ?? {
      enabled: config.actions.autoApprove,
      perHour: config.actions.autoApprovePerHour,
    });
  }

  /** Executions in the last hour — the L2 rate-cap denominator. */
  private async executedLastHour(): Promise<number> {
    const cutoff = Date.now() - 3_600_000;
    return (await this.store.list()).filter(
      (a) => a.executedAt && new Date(a.executedAt).getTime() >= cutoff,
    ).length;
  }

  private async log(action: ProposedAction, event: AuditEvent, detail: string): Promise<void> {
    await this.store.appendAudit({ at: nowIso(), actionId: action.id, event, detail });
  }

  /**
   * Propose a grounded action. The draft is generated from retrieved context via
   * the same trust contract as ask/brief: if nothing grounds it, we refuse rather
   * than invent. Nothing is delivered until a human approves.
   */
  async propose(input: ProposeInput, scopes: string[]): Promise<ProposeResult> {
    const title = input.title.trim() || 'Untitled action';
    const { text, sources } = await this.brain.draft(input.query, input.instruction, scopes);
    if (sources.length === 0) {
      return { ok: false, reason: `No grounded information for "${input.query}" — refusing to draft.` };
    }
    const action: ProposedAction = {
      id: randomUUID(),
      title,
      body: text,
      sources: sources.map((s) => ({ text: s.text, source: s.source })),
      status: 'proposed',
      idempotencyKey: input.idempotencyKey?.trim() || `${title}:${hash(input.query + text)}`,
      createdAt: nowIso(),
    };
    await this.store.save(action);
    await this.log(action, 'proposed', `proposed: ${title}${input.by ? ` (by ${input.by})` : ''}`);

    // L2 autonomy: policy approves grounded proposals without a human click,
    // under the hourly cap. Cap reached → the action WAITS as 'proposed' (falls
    // back to L1 human review) and the audit trail says why.
    if (this.policy.enabled) {
      if ((await this.executedLastHour()) < this.policy.perHour) {
        const decided = await this.approve(action.id, { by: 'policy' });
        if (decided.ok) return { ok: true, action: decided.action };
        return { ok: true, action: (await this.store.get(action.id)) ?? action };
      }
      await this.log(action, 'proposed', `auto-approve skipped: hourly cap (${this.policy.perHour}) reached — awaiting human`);
    }
    return { ok: true, action };
  }

  async approve(id: string, opts: { by?: 'human' | 'policy' } = {}): Promise<DecisionResult> {
    const action = await this.store.get(id);
    if (!action) return { ok: false, reason: 'Action not found.' };

    // Idempotency: already executed → return the original outcome, do NOT re-run.
    if (action.status === 'executed') {
      await this.log(action, 'duplicate-ignored', 'approve called on already-executed action');
      return { ok: true, action };
    }
    if (action.status === 'rejected') return { ok: false, reason: 'Action was rejected.' };
    if (action.status === 'failed') return { ok: false, reason: 'Action previously failed.' };

    await this.log(action, 'approved', opts.by === 'policy' ? 'auto-approved by policy (L2)' : 'human approved');
    // Feedback fuel: an approved action is a positive signal on its draft.
    await getFeedbackStore().record({
      kind: 'action',
      query: action.title,
      answer: action.body,
      verdict: 'approved',
      scopes: [],
    });
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
    await getFeedbackStore().record({
      kind: 'action',
      query: action.title,
      answer: action.body,
      verdict: 'rejected',
      scopes: [],
    });
    return { ok: true, action: rejected };
  }

  list(): Promise<ProposedAction[]> {
    return this.store.list();
  }
  auditLog(): ReturnType<ActionStore['audit']> {
    return this.store.audit();
  }
}
