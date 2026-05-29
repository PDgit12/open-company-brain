/**
 * TEMPLATE — build your own workflow ("action recipe").
 *
 * Copy this file into src/, adjust, and wire it up. A recipe is just:
 *   1. an executor  — what actually happens on approval
 *   2. a proposer   — drafts the action, grounded in the brain
 * and it inherits human-approval, idempotency, and an audit log from the framework.
 *
 * This example adds a "create follow-up task" workflow. (It is in examples/ so it
 * is not compiled into the app — it's a starting point, not live code.)
 */

import { randomUUID } from 'node:crypto';
import type { Brain } from '../src/brain/brain.js';
import type { ActionExecutor } from '../src/actions/executor.js';
import type {
  ProposedAction,
  ExecutionOutcome,
  ProposeResult,
} from '../src/actions/types.js';

// ── 1. The executor: what "doing it" means ───────────────────────────────────
// Swap the body for a real call (your task system, Slack, CRM, etc.). Keep it
// conservative — side effects only, no decisions; the service already enforced
// approval + idempotency before calling you.
export class CreateTaskExecutor implements ActionExecutor {
  async execute(action: ProposedAction): Promise<ExecutionOutcome> {
    const p = action.payload as { title: string; due: string };
    // e.g. await myTaskApi.create({ title: p.title, due: p.due })
    return { effect: `Task created: "${p.title}" (due ${p.due})` };
  }
}

// ── 2. The proposer: draft it, grounded in the brain ─────────────────────────
// Refuse to propose if the brain can't ground the request (the trust contract).
export async function proposeFollowUpTask(
  brain: Brain,
  company: string,
  scopes: string[],
): Promise<ProposeResult> {
  const companyId = brain.resolveCompanyId(company);
  if (!companyId) return { ok: false, reason: `Unknown company "${company}".` };

  // Pull grounding (open actions / recent activity) for the task title.
  const { text, sources } = await brain.draft(
    `${company} open actions next steps follow up`,
    `In one line, state the single most important follow-up task for ${company}, ` +
      `based only on the context. No preamble.`,
    scopes,
  );
  if (sources.length === 0) {
    return { ok: false, reason: `No grounded follow-up found for "${company}".` };
  }

  const action: ProposedAction = {
    id: randomUUID(),
    kind: 'log_engagement', // reuse a kind, or add your own to ActionKind
    company,
    companyId,
    payload: { title: text.trim().slice(0, 120), due: '2026-06-15' } as unknown as ProposedAction['payload'],
    sources: sources.map((s) => ({ text: s.text, source: s.source })),
    status: 'proposed',
    idempotencyKey: `task:${companyId}:${text.slice(0, 40)}`,
    createdAt: new Date().toISOString(),
  };
  return { ok: true, action };
}

/*
 * WIRING (in src/actions/service.ts and src/server/app.ts):
 *   • add a method that calls proposeFollowUpTask + this.store.save + audit
 *   • register CreateTaskExecutor for your action kind in createActionExecutor()
 *   • expose POST /api/actions/create-task
 * approve() then runs it once, audited — same as every other recipe.
 */
