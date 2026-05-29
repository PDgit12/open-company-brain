/**
 * Golden evaluation set — behavioural expectations the brain must keep meeting.
 *
 * These check the properties that matter most: it grounds when it should, and it
 * REFUSES when it has nothing — the trust contract. Run with `npm run eval`, and
 * the same set is asserted in test/eval.test.ts so regressions fail CI.
 */

export type Check = 'has_sources' | 'no_sources' | 'answer_includes' | 'answer_refuses';

export interface GoldenCase {
  name: string;
  kind: 'brief' | 'ask';
  input: string;
  scopes: string[];
  checks: Array<{ check: Check; value?: string }>;
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
