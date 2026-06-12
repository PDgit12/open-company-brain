import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileIntentStore, InMemoryIntentStore } from '../src/intents/registry.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-intents-'));

describe('IntentStore — the closed loop reference signal', () => {
  it('saves with defaults (goal, v1, enabled) and lists scope-filtered', async () => {
    const s = new InMemoryIntentStore();
    const a = await s.save({ statement: 'Ship export API', scopes: ['team-a'] });
    await s.save({ statement: 'Other team thing', scopes: ['team-b'] });
    expect(a.kind).toBe('goal');
    expect(a.version).toBe(1);
    expect(a.enabled).toBe(true);
    expect(await s.list(['team-a'])).toHaveLength(1);
    expect(await s.list()).toHaveLength(2);
  });

  it('update bumps version; file store survives a process restart', async () => {
    const dir = await tempDir();
    const a = await new FileIntentStore(dir).save({ statement: 'Sprint goal', kind: 'spec' });
    const s2 = new FileIntentStore(dir);
    expect((await s2.get(a.id))?.kind).toBe('spec');
    const upd = await s2.update(a.id, { enabled: false });
    expect(upd?.version).toBe(2);
    expect((await new FileIntentStore(dir).get(a.id))?.enabled).toBe(false);
  });
});
