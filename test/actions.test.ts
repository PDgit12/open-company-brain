import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';
import { ActionService, splitEmail } from '../src/actions/service.js';
import { InMemoryActionStore } from '../src/actions/store.js';
import type { ActionExecutor } from '../src/actions/executor.js';
import type { ProposedAction, ExecutionOutcome } from '../src/actions/types.js';

const SCOPES = ['default-team'];

/** Executor that counts how many times it actually ran (to prove idempotency). */
class CountingExecutor implements ActionExecutor {
  public runs = 0;
  async execute(_a: ProposedAction): Promise<ExecutionOutcome> {
    this.runs++;
    return { effect: `executed #${this.runs}` };
  }
}

async function makeService(): Promise<{ svc: ActionService; exec: CountingExecutor }> {
  const brain = await Brain.create();
  const exec = new CountingExecutor();
  return { svc: new ActionService(brain, new InMemoryActionStore(), exec), exec };
}

describe('action layer — propose', () => {
  it('drafts a grounded email proposal for a known company (not executed yet)', async () => {
    const { svc } = await makeService();
    const r = await svc.proposeEmail('Aerodyne', 'follow up on the renewal', SCOPES);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.status).toBe('proposed');
      expect(r.action.sources.length).toBeGreaterThan(0); // grounded
      expect(r.action.kind).toBe('draft_email');
    }
  });

  it('refuses to draft when there is no grounding (trust contract)', async () => {
    const { svc } = await makeService();
    const r = await svc.proposeEmail('Foobar Industries', 'anything', SCOPES);
    expect(r.ok).toBe(false);
  });
});

describe('action layer — approve / idempotency / audit', () => {
  it('executes only after approval, exactly once even if approved twice', async () => {
    const { svc, exec } = await makeService();
    const proposed = await svc.proposeEmail('Aerodyne', 'renewal follow-up', SCOPES);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    expect(exec.runs).toBe(0); // proposing does not execute

    const first = await svc.approve(proposed.action.id);
    expect(first.ok).toBe(true);
    expect(exec.runs).toBe(1);

    const second = await svc.approve(proposed.action.id); // double-click
    expect(second.ok).toBe(true);
    expect(exec.runs).toBe(1); // idempotent — did NOT run again
  });

  it('rejecting prevents execution', async () => {
    const { svc, exec } = await makeService();
    const proposed = await svc.proposeEmail('Aerodyne', 'x', SCOPES);
    if (!proposed.ok) throw new Error('expected proposal');
    await svc.reject(proposed.action.id, 'not now');
    const approved = await svc.approve(proposed.action.id);
    expect(approved.ok).toBe(false);
    expect(exec.runs).toBe(0);
  });

  it('writes an audit trail of every transition', async () => {
    const { svc } = await makeService();
    const proposed = await svc.proposeEmail('Aerodyne', 'x', SCOPES);
    if (!proposed.ok) throw new Error('expected proposal');
    await svc.approve(proposed.action.id);
    const audit = await svc.auditLog();
    const events = audit.map((e) => e.event);
    expect(events).toContain('proposed');
    expect(events).toContain('approved');
    expect(events).toContain('executed');
  });
});

describe('splitEmail', () => {
  it('extracts a Subject line when present', () => {
    expect(splitEmail('Subject: Renewal\n\nHi there', 'Acme')).toEqual({
      subject: 'Renewal',
      body: 'Hi there',
    });
  });
  it('falls back to a default subject when absent', () => {
    expect(splitEmail('Hi there', 'Acme').subject).toBe('Follow-up: Acme');
  });
});
