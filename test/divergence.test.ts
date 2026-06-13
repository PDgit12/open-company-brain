import { describe, it, expect } from 'vitest';
import { parseDivergence, checkIntent, runDivergenceWatch } from '../src/divergence/engine.js';
import type { Llm } from '../src/brain/structured.js';
import type { Intent } from '../src/intents/registry.js';

const intent: Intent = {
  id: 'intent_1', statement: 'Sprint 14 ships the export API by June 20', kind: 'goal',
  scopes: ['team'], enabled: true, version: 1, createdAt: new Date().toISOString(),
};
const meta = { source: 'tickets', scope: 'team' };
const reply = (o: unknown): Llm => async () => JSON.stringify(o);

describe('parseDivergence — enforcement invariants', () => {
  it('a flag WITHOUT evidence is not a flag (rejected)', () => {
    expect(parseDivergence('{"status":"diverged","evidence":[],"rationale":"x"}', 1)).toBeNull();
    expect(parseDivergence('{"status":"diverged","evidence":[1],"rationale":""}', 1)).toBeNull();
    expect(parseDivergence('{"status":"diverged","evidence":[2],"rationale":"x"}', 1)).toBeNull(); // out of range
  });
  it('accepts the three statuses with valid shapes', () => {
    expect(parseDivergence('{"status":"aligned","evidence":[],"rationale":"ok"}', 1)?.status).toBe('aligned');
    expect(parseDivergence('{"status":"insufficient_signal","evidence":[],"rationale":"n/a"}', 1)?.status).toBe('insufficient_signal');
    expect(parseDivergence('{"status":"diverged","evidence":[1],"rationale":"contradicts"}', 1)?.evidence).toEqual([1]);
  });
});

describe('checkIntent — flag-or-silent', () => {
  it('diverged verdict carries the evidencing excerpt + intent ref', async () => {
    const rec = await checkIntent(reply({ status: 'diverged', evidence: [1], rationale: 'deadline moved' }), intent,
      ['Ticket: export API postponed to July'], meta);
    expect(rec.status).toBe('diverged');
    expect(rec.intentRef).toBe('intent_1');
    expect(rec.evidence[0]).toContain('postponed');
  });
  it('invalid model output → insufficient_signal (silent), never a guess', async () => {
    const rec = await checkIntent(async () => 'garbage', intent, ['x'], meta);
    expect(rec.status).toBe('insufficient_signal');
  });
  it('model failure → silent, never throws', async () => {
    const rec = await checkIntent(async () => { throw new Error('down'); }, intent, ['x'], meta);
    expect(rec.status).toBe('insufficient_signal');
  });
});

describe('runDivergenceWatch — the ingest hook', () => {
  it('no intents in scope → no checks, no model calls', async () => {
    let calls = 0;
    const llm: Llm = async () => { calls++; return '{}'; };
    const recs = await runDivergenceWatch({} as never, { content: 'x', source: 's', scope: 'team' }, llm);
    expect(recs).toEqual([]);
    expect(calls).toBe(0);
  });
});

import { renderDivergenceAlert, type DivergenceRecord } from '../src/divergence/engine.js';

describe('renderDivergenceAlert — the flag IS the content (model-free)', () => {
  it('renders intent + evidence + rationale into the alert body', () => {
    const rec: DivergenceRecord = {
      id: 'div_1', status: 'diverged', intentRef: 'intent_1',
      intentStatement: 'Ship export API by June 20',
      evidence: ['Standup: export API will slip to July'],
      rationale: 'deadline contradicted', source: 'standup-notes',
      scope: 'team', at: '2026-06-13T10:00:00Z',
    };
    const body = renderDivergenceAlert(rec);
    expect(body).toContain('DIVERGENCE DETECTED');
    expect(body).toContain('Ship export API by June 20');
    expect(body).toContain('will slip to July');
    expect(body).toContain('deadline contradicted');
  });
});

import { DRAFT_SYSTEM, NO_CONTEXT_REPLY } from '../src/agents/generator.js';
describe('DRAFT_SYSTEM — drafting role does not instruct refusal', () => {
  it('directs production, not refusal (unlike the Q&A system prompt)', () => {
    expect(DRAFT_SYSTEM).toMatch(/do not refuse/i);
    expect(DRAFT_SYSTEM).not.toContain(NO_CONTEXT_REPLY);
  });
});
