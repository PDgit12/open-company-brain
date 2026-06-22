import { describe, it, expect, vi } from 'vitest';

/**
 * Integrity guard: a REAL brain (the one a `comb install` MCP connection gets)
 * holds ONLY the user's ingested data — never the demo seed. install.test.ts
 * proves the install config writes COMB_SEED_DEMO='off'; this proves the runtime
 * consequence: with the seed off, Brain.create() starts empty.
 *
 * The global test setup forces COMB_SEED_DEMO='on' (so the golden evals have
 * data), and config is read once at import — so we override the env and
 * vi.resetModules() to re-import config + Brain under the real-user setting.
 */
describe('no demo-seed leak into a real brain', () => {
  it('seedDemo off → brain starts with zero records', async () => {
    const prev = process.env.COMB_SEED_DEMO;
    process.env.COMB_SEED_DEMO = 'off';
    vi.resetModules();
    try {
      const { Brain } = await import('../src/brain/brain.js');
      const brain = await Brain.create();
      const stats = await brain.knowledgeStats(['default-team']);
      expect(stats).toEqual([]);
    } finally {
      process.env.COMB_SEED_DEMO = prev;
      vi.resetModules();
    }
  });
});
