import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileActionStore } from '../src/actions/store.js';
import type { ProposedAction } from '../src/actions/types.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-actions-'));

const action = (id: string, status: ProposedAction['status'] = 'proposed'): ProposedAction => ({
  id,
  title: `t-${id}`,
  body: 'body',
  sources: [{ text: 'x', source: 's' }],
  status,
  idempotencyKey: `k-${id}`,
  createdAt: new Date().toISOString(),
});

describe('FileActionStore — the durable approval queue', () => {
  it('a pending approval SURVIVES a process restart (fresh store instance)', async () => {
    const dir = await tempDir();
    await new FileActionStore(dir).save(action('a1'));

    // "Restart": a brand-new store (e.g. the CLI in another process).
    const reopened = new FileActionStore(dir);
    const pending = await reopened.list();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: 'a1', status: 'proposed' });
  });

  it('update transitions status durably; audit appends and persists', async () => {
    const dir = await tempDir();
    const s1 = new FileActionStore(dir);
    await s1.save(action('a1'));
    await s1.update({ ...action('a1'), status: 'executed', effect: 'done' });
    await s1.appendAudit({ at: new Date().toISOString(), actionId: 'a1', event: 'executed', detail: 'done' });

    const s2 = new FileActionStore(dir);
    expect((await s2.get('a1'))?.status).toBe('executed');
    expect(await s2.audit()).toHaveLength(1);
  });

  it('lists newest-first', async () => {
    const dir = await tempDir();
    const s = new FileActionStore(dir);
    await s.save({ ...action('old'), createdAt: '2026-01-01T00:00:00Z' });
    await s.save({ ...action('new'), createdAt: '2026-02-01T00:00:00Z' });
    expect((await s.list()).map((a) => a.id)).toEqual(['new', 'old']);
  });
});
