import { describe, it, expect } from 'vitest';
import {
  answered, refusal, memoryReply, isValidRecord, renderAnswer, MEMORY_NOTE,
} from '../src/brain/record.js';

const chunk = { text: 'x', source: 'docs', metadata: {}, score: 0.9 };

describe('AnswerRecord — the typed contract', () => {
  it('refusal is an ENUM with no citations and the canonical prose', () => {
    const r = refusal();
    expect(r.status).toBe('insufficient_context');
    expect(r.citations).toEqual([]);
    expect(isValidRecord(r)).toBe(true);
  });

  it('invariants are enforced in code: answered MUST cite; refusals must NOT', () => {
    expect(isValidRecord(answered('text', []))).toBe(false);     // claim w/o evidence
    expect(isValidRecord(answered('', [chunk]))).toBe(false);    // evidence w/o claim
    expect(isValidRecord(answered('text', [chunk]))).toBe(true);
    expect(isValidRecord({ ...refusal(), citations: [chunk] })).toBe(false); // citing what you refused
  });

  it('renderAnswer is the ONLY place prose is assembled (footer, marker, dedupe)', () => {
    const r = answered('the answer', [chunk, { ...chunk }, { ...chunk, source: 'notes' }]);
    expect(renderAnswer(r)).toBe('the answer\n\nSources: [docs] [notes]'); // deduped
    expect(renderAnswer(refusal())).toBe("I don't have that in the brain yet.");
    expect(renderAnswer(memoryReply('from chat'))).toBe(`from chat\n\n${MEMORY_NOTE}`);
  });
});
