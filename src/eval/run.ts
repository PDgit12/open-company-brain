/**
 * Eval runner — executes the golden set against the brain and scores it.
 *
 *   npm run eval
 *
 * Exits non-zero if any case fails, so it doubles as a CI gate. Runs in whatever
 * mode the environment selects (mock by default).
 */

import { Brain } from '../brain/brain.js';
import { GOLDEN_SET, type GoldenCase } from './golden.js';
import type { BrainAnswer } from '../brain/brain.js';

export interface CaseResult {
  name: string;
  passed: boolean;
  failures: string[];
}

export async function evaluateCase(brain: Brain, c: GoldenCase): Promise<CaseResult> {
  const res: BrainAnswer = await brain.ask(c.input, c.scopes);
  const failures: string[] = [];

  for (const { check, value } of c.checks) {
    // v2: checks read the typed record's FIELDS — refusal is a status enum,
    // grounding is the citations array. No prose parsing.
    switch (check) {
      case 'has_sources':
        if (res.record.citations.length === 0) failures.push('expected sources, got none');
        break;
      case 'no_sources':
        if (res.record.citations.length > 0) failures.push(`expected no sources, got ${res.record.citations.length}`);
        break;
      case 'answer_includes':
        if (value && !res.record.answer.includes(value)) failures.push(`answer missing "${value}"`);
        break;
      case 'answer_refuses':
        if (res.record.status !== 'insufficient_context') failures.push('expected a refusal');
        break;
    }
  }
  return { name: c.name, passed: failures.length === 0, failures };
}

export async function runEval(): Promise<CaseResult[]> {
  const brain = await Brain.create();
  const results: CaseResult[] = [];
  for (const c of GOLDEN_SET) results.push(await evaluateCase(brain, c));
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEval()
    .then((results) => {
      let failed = 0;
      for (const r of results) {
        if (r.passed) {
          console.log(`✓ ${r.name}`);
        } else {
          failed++;
          console.log(`✗ ${r.name}\n    ${r.failures.join('\n    ')}`);
        }
      }
      console.log(`\n${results.length - failed}/${results.length} eval cases passed.`);
      process.exit(failed ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error('✗ Eval failed to run:', err);
      process.exit(1);
    });
}
