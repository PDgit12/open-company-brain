import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ServingOptimizer } from '../src/optimizer/serving.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-ccr-'));

describe('CCR serving optimizer — never larger; dedup across a session', () => {
  it('first serve returns full content; second serve DEDUPS the repeat', async () => {
    const dir = await tempDir();
    const items = [
      { text: 'Refunds over $10,000 require Finance Director approval.', source: 'refund' },
      { text: 'Parental leave is 16 weeks for the primary caregiver.', source: 'leave' },
    ];
    const a = await new ServingOptimizer('sess1', dir).serve(items);
    expect(a.full).toBe(2);
    expect(a.deduped).toBe(0);
    // Same session, overlapping items → deduped to references.
    const b = await new ServingOptimizer('sess1', dir).serve(items);
    expect(b.deduped).toBe(2);
    expect(b.text).toContain('already provided');
    expect(b.tokensAfter).toBeLessThan(b.tokensBefore);
  });

  it('a different session is isolated (no cross-session dedup)', async () => {
    const dir = await tempDir();
    const items = [{ text: 'something', source: 's' }];
    await new ServingOptimizer('sessA', dir).serve(items);
    const other = await new ServingOptimizer('sessB', dir).serve(items);
    expect(other.deduped).toBe(0); // fresh session sees it for the first time
  });

  it('THE RULE: never larger than the raw payload', async () => {
    const a = await new ServingOptimizer('x', await tempDir()).serve([{ text: 'short', source: 's' }]);
    expect(a.tokensAfter).toBeLessThanOrEqual(a.tokensBefore);
  });
});
