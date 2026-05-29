/**
 * The action layer — types.
 *
 * v0 was read-only. The action layer lets agents *propose* actions that a human
 * *approves* before anything happens. Three safety properties are baked in:
 *   • human-in-the-loop  — nothing executes without an explicit approve()
 *   • idempotency        — approving the same action twice executes it once
 *   • audit log          — every proposal/decision/execution is recorded
 *
 * An action is only ever *drafted* from grounded context (the trust contract still
 * holds): if the brain has nothing to ground a draft on, no action is proposed.
 */

export type ActionKind = 'draft_email' | 'log_engagement';

export type ActionStatus =
  | 'proposed' // drafted, awaiting human decision
  | 'executed' // approved and carried out
  | 'rejected' // a human declined it
  | 'failed'; // execution threw

export interface EmailPayload {
  to: string | null;
  subject: string;
  body: string;
}

export interface EngagementPayload {
  companyId: string;
  kind: string;
  date: string; // ISO yyyy-mm-dd
  summary: string;
  openActions: string | null;
}

export type ActionPayload = EmailPayload | EngagementPayload;

export interface ActionSourceRef {
  text: string;
  source: string;
}

export interface ProposedAction {
  id: string;
  kind: ActionKind;
  company: string;
  companyId: string | null;
  payload: ActionPayload;
  /** The grounded records the draft was based on (for the "show your work" UI). */
  sources: ActionSourceRef[];
  status: ActionStatus;
  /** Stable key so re-approving / re-proposing the same intent can't double-fire. */
  idempotencyKey: string;
  createdAt: string;
  decidedAt?: string;
  executedAt?: string;
  /** Human-readable result of execution, e.g. "Queued to outbox". */
  effect?: string;
}

export type AuditEvent =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'duplicate-ignored';

export interface AuditEntry {
  at: string;
  actionId: string;
  event: AuditEvent;
  detail: string;
}

export interface ExecutionOutcome {
  effect: string;
}

/** Discriminated result so callers handle "couldn't ground a draft" explicitly. */
export type ProposeResult =
  | { ok: true; action: ProposedAction }
  | { ok: false; reason: string };

export type DecisionResult =
  | { ok: true; action: ProposedAction }
  | { ok: false; reason: string };
