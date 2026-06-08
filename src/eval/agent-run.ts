/**
 * Agentic eval runner — executes a scenario suite through the harness and scores
 * the AGENT's behaviour (grounding, refusal, tool use, budget, scope, recall).
 *
 *   comb eval [--suite path/to/suite.json]
 *
 * Exits non-zero if any scenario fails, so it doubles as a CI gate. Runs in
 * whatever backend the environment selects: hermetic structural checks on mock,
 * plus the semantic `judge`/memory layer on a live backend.
 */

import { readFile } from 'node:fs/promises';
import { Brain } from '../brain/brain.js';
import { createFabric } from '../tools/assemble.js';
import { config } from '../config.js';
import { pickAgent } from '../harness/run.js';
import { SavedAgent } from '../harness/saved-agent.js';
import { getCustomAgentStore, resolveAgent, type CustomAgent } from '../agents/registry.js';
import { InMemoryConversationStore, bindMemory } from '../agents/conversation.js';
import {
  AGENT_SUITE,
  gradeTurn,
  type AgentScenario,
  type AgentSpec,
  type InlineAgentDef,
  type ScenarioResult,
  type TurnResult,
} from './agent-eval.js';
import type { Agent, AgentContext } from '../harness/agent.js';
import type { ToolFabric } from '../tools/fabric.js';

function inlineAgent(def: InlineAgentDef): CustomAgent {
  const slug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: `eval_${slug}`,
    name: def.name,
    instruction: def.instruction,
    query: (def.query ?? def.name).trim(),
    createdAt: new Date().toISOString(),
  };
}

/** Build the agent a scenario asks for. Returns null when a saved ref is unknown. */
async function buildAgent(spec: AgentSpec | undefined): Promise<Agent | null> {
  if (spec?.define) {
    const def = inlineAgent(spec.define);
    return new SavedAgent(def, { memory: bindMemory(new InMemoryConversationStore(), def.id) });
  }
  if (spec?.saved) {
    const def = await resolveAgent(getCustomAgentStore(), spec.saved);
    if (!def) return null;
    return new SavedAgent(def, { memory: bindMemory(new InMemoryConversationStore(), def.id) });
  }
  return pickAgent(spec?.kind ?? 'auto');
}

async function runScenario(
  scenario: AgentScenario,
  brain: Brain,
  fabric: ToolFabric,
): Promise<ScenarioResult> {
  const agent = await buildAgent(scenario.agent);
  if (!agent) {
    return { name: scenario.name, passed: true, skipped: true, detail: `unknown saved agent "${scenario.agent?.saved}"`, turns: [] };
  }
  const scopes = scenario.scopes ?? [config.demoUserAccessScope];
  const ctx: AgentContext = { brain, fabric, scopes };
  const turns: TurnResult[] = [];
  for (const t of scenario.turns) {
    const result = await agent.run(t.input, ctx);
    const checks = await gradeTurn(t.checks, result);
    turns.push({ input: t.input, output: result.output, toolsUsed: result.steps.map((s) => s.tool), checks });
  }
  const passed = turns.every((t) => t.checks.every((c) => c.status !== 'fail'));
  return { name: scenario.name, passed, turns };
}

export async function runAgentEval(suite: AgentScenario[] = AGENT_SUITE): Promise<ScenarioResult[]> {
  const brain = await Brain.create();
  const fabric = await createFabric(brain, { servers: [] });
  try {
    const results: ScenarioResult[] = [];
    for (const s of suite) results.push(await runScenario(s, brain, fabric));
    return results;
  } finally {
    await fabric.close();
  }
}

async function loadSuite(argv: string[]): Promise<AgentScenario[]> {
  const i = argv.indexOf('--suite');
  if (i === -1) return AGENT_SUITE;
  const path = argv[i + 1];
  if (!path) throw new Error('--suite needs a file path');
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('suite file must be a JSON array of scenarios');
  return parsed as AgentScenario[];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const usingDefault = !process.argv.includes('--suite');
  // The default suite asserts against the MOCK demo seed (Project Atlas, etc.).
  // On a real brain the content/scope checks are data-dependent — point the user
  // at --suite so a misread "X/4 passed" isn't taken as a harness fault.
  if (usingDefault && config.backend !== 'mock') {
    console.log(
      `note: the default suite targets the demo seed; on the ${config.backend} backend, ` +
        `write a suite for your own data:  comb eval --suite my-suite.json\n`,
    );
  }
  loadSuite(process.argv.slice(2))
    .then(runAgentEval)
    .then((results) => {
      let failed = 0;
      let skipped = 0;
      for (const r of results) {
        if (r.skipped) {
          skipped++;
          console.log(`○ ${r.name}  (skipped: ${r.detail})`);
          continue;
        }
        console.log(`${r.passed ? '✓' : '✗'} ${r.name}`);
        for (const t of r.turns) {
          for (const c of t.checks) {
            if (c.status === 'fail') console.log(`    ✗ ${c.check}: ${c.detail}`);
            else if (c.status === 'skip') console.log(`    ○ ${c.check}: ${c.detail}`);
          }
        }
        if (!r.passed) failed++;
      }
      const ran = results.length - skipped;
      console.log(`\n${ran - failed}/${ran} scenarios passed${skipped ? `, ${skipped} skipped` : ''}.`);
      process.exit(failed ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error('✗ Agent eval failed to run:', err);
      process.exit(1);
    });
}
