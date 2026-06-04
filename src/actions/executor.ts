/**
 * What actually happens when a human approves an action.
 *
 * SAFETY POSTURE: execution is intentionally conservative. The default delivery
 * sink only RECORDS the action (an outbox) — nothing is sent anywhere until you
 * deliberately configure a file or webhook sink. A bug therefore cannot blast
 * real messages; wiring real delivery is a separate, explicit decision.
 *
 * The executor never decides *whether* to run — the service already enforced
 * human approval and idempotency before calling it.
 */

import { createDeliverySink, type DeliverySink } from './delivery.js';
import type { ProposedAction, ExecutionOutcome } from './types.js';

export interface ActionExecutor {
  execute(action: ProposedAction): Promise<ExecutionOutcome>;
}

export class DefaultActionExecutor implements ActionExecutor {
  constructor(private readonly sink: DeliverySink) {}

  async execute(action: ProposedAction): Promise<ExecutionOutcome> {
    // Real delivery happens through the configured sink (outbox | file | webhook).
    // The default outbox sink records only; file/webhook actually write/send.
    const effect = await this.sink.deliver(action);
    return { effect };
  }
}

export function createActionExecutor(): ActionExecutor {
  return new DefaultActionExecutor(createDeliverySink());
}
