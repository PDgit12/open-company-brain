import { describe, it, expect } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { OutboxSink, FileSink } from '../src/actions/delivery.js';
import type { ProposedAction } from '../src/actions/types.js';

const action: ProposedAction = {
  id: 'a1',
  title: 'Follow-up note',
  body: 'Hi — quick follow-up on the migration plan.',
  sources: [],
  status: 'proposed',
  idempotencyKey: 'k',
  createdAt: '2026-05-01T00:00:00.000Z',
};

describe('delivery sinks', () => {
  it('OutboxSink records only (sends nothing)', async () => {
    const effect = await new OutboxSink().deliver(action);
    expect(effect.toLowerCase()).toContain('outbox');
  });

  it('FileSink really writes the action to a JSONL file', async () => {
    const dir = path.join('/tmp', `cb-outbox-${process.pid}`);
    await rm(dir, { recursive: true, force: true });
    const effect = await new FileSink(dir).deliver(action);
    expect(effect).toContain('Delivered');

    const written = await readFile(path.join(dir, 'actions.jsonl'), 'utf8');
    const record = JSON.parse(written.trim());
    expect(record.id).toBe('a1');
    expect(record.title).toBe('Follow-up note');
    await rm(dir, { recursive: true, force: true });
  });
});
