/**
 * Golden evaluation set — behavioural expectations the brain must keep meeting.
 *
 * These check the properties that matter most: it grounds when it should, and it
 * REFUSES when it has nothing — the trust contract. Run with `npm run eval`, and
 * the same set is asserted in test/eval.test.ts so regressions fail CI.
 */

import { NO_CONTEXT_REPLY } from '../agents/generator.js';
import type { FeedbackEvent } from '../feedback/feedback.js';

export type Check = 'has_sources' | 'no_sources' | 'answer_includes' | 'answer_refuses';

export interface GoldenCase {
  name: string;
  kind: 'brief' | 'ask';
  input: string;
  scopes: string[];
  checks: Array<{ check: Check; value?: string }>;
  /** 'curated' = hand-written; 'feedback' = auto-grown from a rejected answer. */
  source?: 'curated' | 'feedback';
}

export const GOLDEN_SET: GoldenCase[] = [
  {
    name: 'briefs a known partner with grounded sources',
    kind: 'brief',
    input: 'Aerodyne',
    scopes: ['default-team'],
    checks: [{ check: 'has_sources' }, { check: 'answer_includes', value: 'Aerodyne' }],
  },
  {
    name: 'refuses for an unknown partner',
    kind: 'ask',
    input: 'What is our history with Foobar Industries?',
    scopes: ['default-team'],
    checks: [{ check: 'no_sources' }, { check: 'answer_refuses' }],
  },
  {
    name: 'answers a thematic question across partners',
    kind: 'ask',
    input: 'Which partners care about ML research?',
    scopes: ['default-team'],
    checks: [{ check: 'has_sources' }],
  },
  {
    name: 'hides leadership-only records from a default-team caller',
    kind: 'ask',
    input: 'confidential mandate sensitive figures',
    scopes: ['default-team'],
    checks: [{ check: 'no_sources' }],
  },
];

/**
 * Auto-grow the eval set from real failures (Phase 3, step 3 of the learning loop).
 *
 * We only know an answer was *wrong*, never the correct text — so we derive cases
 * only where a structural expectation is defensible: a **rejected refusal** (the
 * brain said "I don't know" but a human marked that wrong) means grounding existed
 * and should have been found. Once fixed, the brain must return sources for that
 * query — an assertable `has_sources` regression target.
 *
 * Wrong-but-answered cases are intentionally NOT emitted: asserting them needs a
 * human-supplied ground truth, so they belong in a curation queue, not CI.
 *
 * SCOPE SAFETY: gated exactly like recall — an unscoped event, or one whose scopes
 * the caller can't see, is dropped so a confidential query string never leaks.
 */
export function candidateCasesFromFeedback(
  events: FeedbackEvent[],
  scopes: string[],
): GoldenCase[] {
  const allowed = new Set(scopes);
  const seen = new Set<string>();
  const cases: GoldenCase[] = [];
  for (const e of events) {
    if (e.kind !== 'answer' || e.reward >= 0) continue;
    if (!(e.scopes.length > 0 && e.scopes.every((s) => allowed.has(s)))) continue;
    if (!e.answer.includes(NO_CONTEXT_REPLY)) continue; // only rejected refusals are assertable
    const input = e.query.trim();
    if (!input || seen.has(input.toLowerCase())) continue;
    seen.add(input.toLowerCase());
    cases.push({
      name: `regression: brain refused but a human expected an answer — "${input}"`,
      kind: 'ask',
      input,
      scopes: e.scopes,
      checks: [{ check: 'has_sources' }],
      source: 'feedback',
    });
  }
  return cases;
}
