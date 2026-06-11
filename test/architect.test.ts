import { describe, it, expect } from 'vitest';
import { parseAgentDraft, fallbackDraft, draftAgent } from '../src/agents/architect.js';

describe('parseAgentDraft — lenient model-output parsing', () => {
  it('extracts a valid draft from JSON wrapped in prose', () => {
    const text = `Sure! Here you go:\n{
      "name": "Renewal Watch",
      "instruction": "Track renewals. Cite sources.",
      "query": "renewal contract dates",
      "answerable": ["Which contracts renew soon?"],
      "unanswerable": ["What is the moon made of?"]
    }\nHope that helps!`;
    const d = parseAgentDraft(text);
    expect(d).not.toBeNull();
    expect(d!.name).toBe('Renewal Watch');
    expect(d!.labels).toEqual([
      { query: 'Which contracts renew soon?', answerable: true },
      { query: 'What is the moon made of?', answerable: false },
    ]);
  });

  it('rejects junk: no JSON, broken JSON, or missing required fields', () => {
    expect(parseAgentDraft('no json here')).toBeNull();
    expect(parseAgentDraft('{ "name": "X" ')).toBeNull();
    expect(parseAgentDraft('{ "name": "X", "instruction": "" , "query": "y"}')).toBeNull();
  });
});

describe('fallbackDraft — deterministic, zero-credential path', () => {
  it('builds a sane draft from the wish alone', () => {
    const d = fallbackDraft('watch our customer renewals and flag churn risks');
    expect(d.draftedBy).toBe('fallback');
    expect(d.name.length).toBeGreaterThan(0);
    expect(d.instruction).toContain('cite');
    expect(d.query).toContain('renewals');
    // Starter labels include the wish itself (answerable) + canned unanswerables.
    expect(d.labels.filter((l) => l.answerable)).toHaveLength(1);
    expect(d.labels.filter((l) => !l.answerable).length).toBeGreaterThanOrEqual(2);
  });
});

describe('draftAgent — never blocks', () => {
  it('uses the fallback on the mock backend (no model to draft with)', async () => {
    const d = await draftAgent('summarize weekly engineering incidents');
    expect(d.draftedBy).toBe('fallback');
    expect(d.name).toBeTruthy();
  });
});
