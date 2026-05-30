/**
 * What actually happens when a human approves an action.
 *
 * SAFETY POSTURE: execution is intentionally conservative.
 *   • Email is NEVER silently sent — it is queued to an "outbox" (a recorded
 *     intent). Wiring a real mail provider is a deliberate, separate step so a
 *     bug can't blast emails to real partners.
 *   • Logging an engagement writes back to YOUR Postgres in live mode; in mock
 *     mode it is recorded but not persisted, and says so honestly.
 *
 * The executor never decides *whether* to run — the service already enforced
 * human approval and idempotency before calling it.
 */

import pg from 'pg';
import { config } from '../config.js';
import { createDeliverySink, type DeliverySink } from './delivery.js';
import type { ProposedAction, ExecutionOutcome, EmailPayload, EngagementPayload } from './types.js';

export interface ActionExecutor {
  execute(action: ProposedAction): Promise<ExecutionOutcome>;
}

export class DefaultActionExecutor implements ActionExecutor {
  /** pool is null in mock/seed mode. */
  constructor(
    private readonly pool: pg.Pool | null,
    private readonly sink: DeliverySink,
  ) {}

  async execute(action: ProposedAction): Promise<ExecutionOutcome> {
    switch (action.kind) {
      case 'draft_email':
        return this.deliverEmail(action);
      case 'log_engagement':
        return this.logEngagement(action.payload as EngagementPayload);
      default:
        throw new Error(`Unknown action kind: ${(action as ProposedAction).kind}`);
    }
  }

  private async deliverEmail(action: ProposedAction): Promise<ExecutionOutcome> {
    // Real delivery happens through the configured sink (outbox | file | webhook).
    // The default outbox sink records only; file/webhook actually write/send.
    const p = action.payload as EmailPayload;
    const effect = await this.sink.deliver(action);
    return { effect: `${effect} — subject: "${p.subject}"` };
  }

  private async logEngagement(p: EngagementPayload): Promise<ExecutionOutcome> {
    if (!this.pool) {
      return {
        effect: `Recorded (mock mode — not persisted): ${p.kind} engagement for company ${p.companyId} on ${p.date}`,
      };
    }
    const id = `eng_${Date.now()}`;
    await this.pool.query(
      `INSERT INTO engagements (id, company_id, kind, date, summary, open_actions, access, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
      [id, p.companyId, p.kind, p.date, p.summary, p.openActions, config.demoUserAccessScope],
    );
    return { effect: `Engagement ${id} written to Postgres for company ${p.companyId}.` };
  }
}

export function createActionExecutor(): ActionExecutor {
  const pool =
    config.dataMode === 'postgres' && config.database.url
      ? new pg.Pool({ connectionString: config.database.url })
      : null;
  return new DefaultActionExecutor(pool, createDeliverySink());
}
