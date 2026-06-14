/**
 * The action layer — types.
 *
 * The brain is read-first, but agents can *propose* an action that a human
 * *approves* before anything leaves the system. Three safety properties are
 * baked in:
 *   • human-in-the-loop  — nothing executes without an explicit approve()
 *   • idempotency        — approving the same action twice executes it once
 *   • audit log          — every proposal/decision/execution is recorded
 *
 * An action is universal: it is just a grounded `title` + `body` (e.g. a drafted
 * message, a summary to post, a webhook payload) with the records that grounded
 * it. It is only ever *drafted* from grounded context — if the brain has nothing
 * to ground it on, no action is proposed (the trust contract still holds).
 */

export type ActionStatus =
  | 'proposed' // drafted, awaiting human decision
  | 'executed' // approved and carried out
  | 'rejected' // a human declined it
  | 'failed'; // execution threw

/**
 * The real-world OUTCOME of a delivered action — the Signal rung of the loop.
 * Unlike approve/reject (a human verdict at decision time) or executed/failed
 * (did delivery throw), this is what actually happened AFTER the action landed:
 * the measured consequence that turns "task complete" into "task worked".
 */
export type ActionOutcome =
  | 'replied' // the recipient engaged back
  | 'converted' // the action produced its intended result (a sale, a fix, a yes)
  | 'ignored' // landed but no engagement
  | 'error' // bounced / rejected downstream / wrong
  | 'reverted'; // had to be undone

export interface ActionSourceRef {
  text: string;
  source: string;
}

export interface ProposedAction {
  id: string;
  /** Short human label, e.g. "Follow-up email" or "Post incident summary". */
  title: string;
  /** The grounded draft a human reviews before approving. */
  body: string;
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
  /** Real-world outcome reported after delivery (the Signal rung). */
  outcome?: ActionOutcome;
  outcomeAt?: string;
  /** Optional free-text evidence for the outcome ("manager replied: approved"). */
  outcomeEvidence?: string;
}

export type AuditEvent =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'outcome'
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

/** Result of recording a real-world outcome; `reward` is what fed the loop. */
export type OutcomeResult =
  | { ok: true; action: ProposedAction; reward: number }
  | { ok: false; reason: string };
