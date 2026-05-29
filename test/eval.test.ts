import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';
import { GOLDEN_SET } from '../src/eval/golden.js';
import { evaluateCase } from '../src/eval/run.js';

/** The golden eval set, asserted so behavioural regressions fail CI. */
describe('golden eval set', () => {
  it.each(GOLDEN_SET.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const brain = await Brain.create();
    const result = await evaluateCase(brain, c);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
