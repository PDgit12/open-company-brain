import { describe, it, expect } from 'vitest';
import {
  AGENT_SUITE,
  gradeStructural,
  gradeTurn,
  type AgentCheck,
} from '../src/eval/agent-eval.js';
import { runAgentEval } from '../src/eval/agent-run.js';
import type { AgentResult } from '../src/harness/agent.js';

const result = (output: string, tools: string[] = []): AgentResult => ({
  output,
  steps: tools.map((t) => ({ tool: t, args: {}, result: 'ok' })),
});

describe('gradeStructural — behavioural checks over AgentResult', () => {
  it('cites_sources passes only with the Sources footer', () => {
    expect(gradeStructural({ check: 'cites_sources' }, result('answer\n\nSources: [a]')).status).toBe('pass');
    expect(gradeStructural({ check: 'cites_sources' }, result('answer')).status).toBe('fail');
  });

  it('refuses passes on the no-context reply', () => {
    expect(gradeStructural({ check: 'refuses' }, result("I don't have that in the brain yet.")).status).toBe('pass');
    expect(gradeStructural({ check: 'refuses' }, result('here is an answer')).status).toBe('fail');
  });

  it('uses_tool passes when the tool is in the trace, skips with no trace', () => {
    expect(gradeStructural({ check: 'uses_tool', value: 'brain.search' }, result('x', ['brain.search'])).status).toBe('pass');
    expect(gradeStructural({ check: 'uses_tool', value: 'brain.search' }, result('x', ['other'])).status).toBe('fail');
    // No steps at all → backend can't call tools → skip, not fail.
    expect(gradeStructural({ check: 'uses_tool', value: 'brain.search' }, result('x', [])).status).toBe('skip');
  });

  it('no_tool passes only without tool calls', () => {
    expect(gradeStructural({ check: 'no_tool' }, result('x')).status).toBe('pass');
    expect(gradeStructural({ check: 'no_tool' }, result('x', ['brain.search'])).status).toBe('fail');
  });

  it('max_output_tokens enforces a ceiling', () => {
    expect(gradeStructural({ check: 'max_output_tokens', value: '100' }, result('short')).status).toBe('pass');
    expect(gradeStructural({ check: 'max_output_tokens', value: '1' }, result('x'.repeat(400))).status).toBe('fail');
  });

  it('judge always skips on the mock backend (semantic, live-only)', () => {
    expect(gradeStructural({ check: 'judge', value: 'rubric' }, result('x')).status).toBe('skip');
  });
});

describe('gradeTurn — mixes structural + judge', () => {
  it('routes judge to a skip on mock and grades the rest', async () => {
    const checks: AgentCheck[] = [
      { check: 'cites_sources' },
      { check: 'judge', value: 'is good' },
    ];
    const checked = await gradeTurn(checks, result('a\n\nSources: [x]'));
    expect(checked.map((c) => c.status)).toEqual(['pass', 'skip']);
  });
});

describe('runAgentEval — the default suite is green on the mock backend', () => {
  it('passes every scenario (semantic memory check skips, not fails)', async () => {
    const results = await runAgentEval();
    const failing = results.filter((r) => !r.passed);
    expect(failing, JSON.stringify(failing, null, 2)).toHaveLength(0);

    // The trust-contract scenario actually refused.
    const refusal = results.find((r) => r.name.includes('refuses an unknown topic'));
    expect(refusal?.turns[0]!.checks[0]!.status).toBe('pass');

    // The memory scenario's judge check is skipped on mock (not a false pass).
    const memory = results.find((r) => r.name.includes('memory'));
    const judge = memory?.turns[1]!.checks.find((c) => c.check === 'judge');
    expect(judge?.status).toBe('skip');
  });

  it('ships a non-empty default suite covering the core agentic properties', () => {
    expect(AGENT_SUITE.length).toBeGreaterThanOrEqual(4);
    const checks = AGENT_SUITE.flatMap((s) => s.turns.flatMap((t) => t.checks.map((c) => c.check)));
    expect(new Set(checks)).toEqual(new Set(['cites_sources', 'output_includes', 'no_tool', 'max_output_tokens', 'refuses', 'judge']));
  });
});
