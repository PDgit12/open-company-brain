import { describe, it, expect } from 'vitest';
import { classifyRun, toRecord } from '../src/observability/runs.js';
import { scenarioFromRun } from '../src/eval/agent-eval.js';
import type { AgentResult } from '../src/harness/agent.js';

const run = (agent: string, input: string, r: AgentResult, scopes = ['team']) =>
  toRecord(agent, scopes, input, r, 5);
const result = (output: string, tools: string[] = []): AgentResult => ({
  output,
  steps: tools.map((t) => ({ tool: t, args: {}, result: 'ok' })),
});

describe('classifyRun — failure-shaped review signals', () => {
  it('flags a refusal', () => {
    expect(classifyRun(result("I don't have that in the brain yet."))).toBe('refused');
  });
  it('flags an ungrounded answer (no citation, no tools)', () => {
    expect(classifyRun(result('here is a confident answer'))).toBe('ungrounded');
  });
  it('passes a cited answer or a tool-using answer', () => {
    expect(classifyRun(result('answer\n\nSources: [a]'))).toBe('ok');
    expect(classifyRun(result('answer', ['brain.search']))).toBe('ok');
  });
});

describe('scenarioFromRun — prod run → regression eval case', () => {
  it('maps a saved agent run to a cites_sources regression by default', () => {
    const r = run('saved:Renewals', 'What renews this month?', result("I don't have that in the brain yet."));
    const s = scenarioFromRun(r);
    expect(s.agent).toEqual({ saved: 'Renewals' });
    expect(s.scopes).toEqual(['team']);
    expect(s.turns[0]!.input).toBe('What renews this month?');
    expect(s.turns[0]!.checks).toEqual([{ check: 'cites_sources' }]);
    expect(s.name).toContain('regression');
  });

  it('maps a generic agent run by kind, and can lock in a correct refusal', () => {
    const r = run('builtin', 'Unknown topic', result("I don't have that in the brain yet."));
    const s = scenarioFromRun(r, { expectRefusal: true });
    expect(s.agent).toEqual({ kind: 'builtin' });
    expect(s.turns[0]!.checks).toEqual([{ check: 'refuses' }]);
  });
});
