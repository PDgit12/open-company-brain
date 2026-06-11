import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';
import { ActionService } from '../src/actions/service.js';

/**
 * L2 autonomy: policy approves grounded proposals without a human click,
 * bounded by an hourly cap. The grounded query targets the mock seed.
 */
const input = (n: number) => ({
  title: `Atlas update ${n}`,
  instruction: 'Draft a short status note.',
  query: 'Project Atlas migration plan',
  idempotencyKey: `atlas-${n}`,
});

describe('ActionService — L2 auto-approve policy', () => {
  it('default policy is OFF: proposals wait for a human', async () => {
    const svc = ActionService.create(await Brain.create(), { enabled: false, perHour: 20 });
    const r = await svc.propose(input(1), ['default-team']);
    expect(r.ok && r.action.status).toBe('proposed');
  });

  it('when ON, a grounded proposal executes immediately and is audited as policy', async () => {
    const svc = ActionService.create(await Brain.create(), { enabled: true, perHour: 20 });
    const r = await svc.propose(input(1), ['default-team']);
    expect(r.ok && r.action.status).toBe('executed');
    const audit = await svc.auditLog();
    expect(audit.some((e) => e.event === 'approved' && e.detail.includes('policy'))).toBe(true);
    expect(audit.some((e) => e.detail === 'human approved')).toBe(false);
  });

  it('the hourly cap halts autonomy: over-cap proposals fall back to human review', async () => {
    const svc = ActionService.create(await Brain.create(), { enabled: true, perHour: 2 });
    const r1 = await svc.propose(input(1), ['default-team']);
    const r2 = await svc.propose(input(2), ['default-team']);
    const r3 = await svc.propose(input(3), ['default-team']);
    expect(r1.ok && r1.action.status).toBe('executed');
    expect(r2.ok && r2.action.status).toBe('executed');
    expect(r3.ok && r3.action.status).toBe('proposed'); // cap reached → waits
    const audit = await svc.auditLog();
    expect(audit.some((e) => e.detail.includes('hourly cap'))).toBe(true);
  });

  it('ungrounded proposals are refused BEFORE policy — autonomy never overrides the trust contract', async () => {
    const svc = ActionService.create(await Brain.create(), { enabled: true, perHour: 20 });
    const r = await svc.propose(
      { title: 'X', instruction: 'Draft.', query: 'Foobar Industries unknowable topic' },
      ['default-team'],
    );
    expect(r.ok).toBe(false);
  });
});
