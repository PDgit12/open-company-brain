/**
 * Delivery sinks — where an executed action's effect actually goes.
 *
 *   • OutboxSink (default)  — record-only; returns the effect, sends nothing.
 *   • FileSink              — appends the action to a real JSONL file. Fully
 *                             verifiable end-to-end with no external service.
 *   • WebhookSink           — POSTs the action to a URL (Slack/Zapier/your API).
 *
 * This is the seam where "real delivery" plugs in. Adding a provider (Resend,
 * SendGrid, a CRM) means writing one more Sink — approval, idempotency, and
 * audit already happen upstream in ActionService.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { ProposedAction } from './types.js';

export interface DeliverySink {
  deliver(action: ProposedAction): Promise<string>; // returns a human-readable effect
}

export class OutboxSink implements DeliverySink {
  async deliver(action: ProposedAction): Promise<string> {
    return `Recorded to outbox (no delivery configured): ${action.kind} for ${action.company}`;
  }
}

export class FileSink implements DeliverySink {
  constructor(private readonly dir: string) {}
  async deliver(action: ProposedAction): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${action.kind}.jsonl`);
    const record = {
      at: new Date().toISOString(),
      id: action.id,
      company: action.company,
      payload: action.payload,
    };
    await appendFile(file, JSON.stringify(record) + '\n', 'utf8');
    return `Delivered: appended to ${file}`;
  }
}

export class WebhookSink implements DeliverySink {
  constructor(private readonly url: string) {}
  async deliver(action: ProposedAction): Promise<string> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: action.kind, company: action.company, payload: action.payload }),
    });
    if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
    return `Delivered: POST ${this.url} → ${res.status}`;
  }
}

export function createDeliverySink(): DeliverySink {
  switch (config.delivery.kind) {
    case 'file':
      return new FileSink(config.delivery.outboxPath);
    case 'webhook':
      if (!config.delivery.webhookUrl) {
        throw new Error('ACTION_DELIVERY=webhook requires ACTION_WEBHOOK_URL.');
      }
      return new WebhookSink(config.delivery.webhookUrl);
    default:
      return new OutboxSink();
  }
}
