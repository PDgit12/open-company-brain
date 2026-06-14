import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InMemorySkillStore, FileSkillStore, scoreSkill, findIn, type Skill } from '../src/skills/registry.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-skills-'));
const mk = (over: Partial<Skill>): Skill => ({
  id: 's1', name: 'Handle a refund request', triggers: ['refund', 'return', 'money back'],
  body: 'Verify order, check policy, issue credit up to $2000.', scopes: ['team'], uses: 0, version: 1,
  updatedAt: new Date().toISOString(), ...over,
});

describe('skill store — model-free, trigger-matched (knitbrain shape)', () => {
  it('derives triggers from the name when none given; defaults uses/version', async () => {
    const s = await new InMemorySkillStore().save({ name: 'Handle a refund request', body: 'do x' });
    expect(s.triggers).toContain('refund');
    expect(s.uses).toBe(0);
    expect(s.version).toBe(1);
  });

  it('scoreSkill ranks by trigger overlap', () => {
    const q = new Set(['customer', 'wants', 'refund']);
    expect(scoreSkill(mk({}), q)).toBeGreaterThan(0);
    expect(scoreSkill(mk({ triggers: ['incident', 'sev1'] }), q)).toBe(0);
  });

  it('findIn returns scope-visible matches, best first', () => {
    const skills = [
      mk({ id: 'refund', triggers: ['refund'] }),
      mk({ id: 'incident', name: 'Incident', triggers: ['incident', 'sev1'] }),
      mk({ id: 'other-scope', triggers: ['refund'], scopes: ['otherteam'] }),
    ];
    const hits = findIn(skills, 'customer refund please', ['team']);
    expect(hits.map((s) => s.id)).toEqual(['refund']); // incident no match, other-scope filtered
  });

  it('file store persists + bumpUses survives a restart', async () => {
    const dir = await tempDir();
    const a = await new FileSkillStore(dir).save({ name: 'Pricing exception', body: 'approve per tier' });
    await new FileSkillStore(dir).bumpUses(a.id);
    expect((await new FileSkillStore(dir).get(a.id))?.uses).toBe(1);
  });

  // Regression: find_skill bumped each hit in a loop (k read+write cycles per
  // query). bumpUsesMany must increment exactly the named ids in ONE write,
  // leave unnamed skills untouched, and be a safe no-op on [].
  it('bumpUsesMany increments only the named skills, in one batch', async () => {
    const dir = await tempDir();
    const store = new FileSkillStore(dir);
    const a = await store.save({ name: 'Handle a refund request', body: 'x' });
    const b = await store.save({ name: 'Run an incident', body: 'y' });
    const c = await store.save({ name: 'Onboard a vendor', body: 'z' });
    await new FileSkillStore(dir).bumpUsesMany([a.id, c.id]);
    await new FileSkillStore(dir).bumpUsesMany([]); // no-op, no throw
    const fresh = new FileSkillStore(dir);
    expect((await fresh.get(a.id))?.uses).toBe(1);
    expect((await fresh.get(b.id))?.uses).toBe(0); // untouched
    expect((await fresh.get(c.id))?.uses).toBe(1);
  });

  it('InMemory bumpUsesMany dedupes ids (one increment per skill per call)', async () => {
    const store = new InMemorySkillStore();
    const a = await store.save({ name: 'Handle a refund request', body: 'x' });
    const b = await store.save({ name: 'Run an incident', body: 'y' });
    await store.bumpUsesMany([a.id, a.id]); // deduped → +1, matching find()'s unique hits
    expect((await store.get(a.id))?.uses).toBe(1);
    expect((await store.get(b.id))?.uses).toBe(0);
  });
});
