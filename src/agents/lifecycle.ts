/**
 * The creation spine, stages 3–4: BIRTH KIT and COMMISSIONING.
 *
 * No agent exists without its own test harness ("born tested"):
 *
 *   BIRTH KIT  — built at creation from the agent's calibration labels:
 *     · answerable labels   → starter eval scenarios asserting cites_sources
 *     · unanswerable labels → scenarios asserting refuses
 *     Persisted per-agent under the data dir, so the kit survives processes
 *     and the suite can be re-run (and grown) for the agent's whole career.
 *
 *   COMMISSIONING — the gate: a v2-created agent starts commissioned=false
 *     and may not run until its starter suite PASSES (`comb commission`).
 *     A failing agent stays a draft. Legacy agents are grandfathered
 *     (normalized commissioned=true) so nothing deployed breaks.
 *
 * The suite runner is INJECTED so the gate logic is hermetically testable;
 * production wires the real agentic eval runner.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { LabeledQuery } from '../brain/grounding.js';
import type { AgentScenario, ScenarioResult } from '../eval/agent-eval.js';
import type { CustomAgent, CustomAgentStore } from './registry.js';

export interface BirthKit {
  agentId: string;
  agentName: string;
  labels: LabeledQuery[];
  scenarios: AgentScenario[];
  createdAt: string;
}

/** Starter eval scenarios derived from calibration labels — behavioral, hermetic-safe. */
export function buildStarterScenarios(agent: CustomAgent, labels: LabeledQuery[]): AgentScenario[] {
  return labels.map((l) => ({
    name: l.answerable
      ? `birth: grounds+cites — "${l.query.slice(0, 50)}"`
      : `birth: refuses — "${l.query.slice(0, 50)}"`,
    agent: { saved: agent.id },
    turns: [{ input: l.query, checks: [l.answerable ? { check: 'cites_sources' as const } : { check: 'refuses' as const }] }],
  }));
}

export function buildBirthKit(agent: CustomAgent, labels: LabeledQuery[]): BirthKit {
  return {
    agentId: agent.id,
    agentName: agent.name,
    labels,
    scenarios: buildStarterScenarios(agent, labels),
    createdAt: new Date().toISOString(),
  };
}

const kitPath = (dataDir: string, agentId: string): string =>
  path.join(dataDir, 'birthkits', `${agentId}.json`);

export async function saveBirthKit(kit: BirthKit, dataDir = config.comb.dataDir): Promise<void> {
  await mkdir(path.dirname(kitPath(dataDir, kit.agentId)), { recursive: true });
  await writeFile(kitPath(dataDir, kit.agentId), JSON.stringify(kit, null, 2) + '\n', 'utf8');
}

export async function loadBirthKit(agentId: string, dataDir = config.comb.dataDir): Promise<BirthKit | null> {
  try {
    return JSON.parse(await readFile(kitPath(dataDir, agentId), 'utf8')) as BirthKit;
  } catch {
    return null;
  }
}

export interface CommissionOutcome {
  passed: boolean;
  /** Scenario results (empty when no kit existed — see grandfathered). */
  results: ScenarioResult[];
  /** True when no birth kit exists (legacy agent) — commissioned without a run. */
  grandfathered: boolean;
}

export type SuiteRunner = (suite: AgentScenario[]) => Promise<ScenarioResult[]>;

/**
 * THE GATE. Runs the agent's starter suite; only a full pass flips
 * commissioned=true. Skipped checks (e.g. judge on mock) don't fail the gate —
 * the same pass-rule the eval runner uses everywhere.
 */
export async function commission(
  agent: CustomAgent,
  store: CustomAgentStore,
  runSuite: SuiteRunner,
  dataDir = config.comb.dataDir,
): Promise<CommissionOutcome> {
  const kit = await loadBirthKit(agent.id, dataDir);
  if (!kit) {
    await store.update(agent.id, { commissioned: true });
    return { passed: true, results: [], grandfathered: true };
  }
  const results = await runSuite(kit.scenarios);
  const passed = results.every((r) => r.passed);
  if (passed) await store.update(agent.id, { commissioned: true });
  return { passed, results, grandfathered: false };
}
