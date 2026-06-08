/**
 * Comb harness — the operator shell. A polished, Claude-Code-style terminal:
 *
 *   comb run "<task>" [--agent auto|builtin|tools] [--scopes a,b]   one-shot
 *   comb chat        [--agent …] [--scopes …]                       REPL
 *
 * It runs the chosen agent on the governed kernel + connected tools, showing
 * each tool call live (spinner while the model thinks), then the cited answer.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Brain } from '../brain/brain.js';
import { config, describeMode } from '../config.js';
import { createFabric } from '../tools/assemble.js';
import { pickAgent, type AgentKind } from './run.js';
import { getCustomAgentStore, resolveAgent } from '../agents/registry.js';
import { bindMemory, getConversationStore } from '../agents/conversation.js';
import { getResponseCache } from './cache.js';
import { getTokenBudget, scopeKey } from './tokens.js';
import { SavedAgent, type SavedAgentOptions } from './saved-agent.js';
import { getRunStore, tracedRun, classifyRun, type RunConcern } from '../observability/runs.js';
import { scenarioFromRun } from '../eval/agent-eval.js';
import { readFile, writeFile } from 'node:fs/promises';
import type { Agent, AgentContext, AgentResult, AgentStep } from './agent.js';
import type { ToolFabric } from '../tools/fabric.js';

// ── tiny ANSI palette (TTY-only; degrades to plain text when piped) ──────────
const tty = stdout.isTTY;
const wrap = (open: string) => (s: string) => (tty ? `\x1b[${open}m${s}\x1b[0m` : s);
const dim = wrap('2');
const bold = wrap('1');
const coral = wrap('38;5;209');
const butter = wrap('38;5;222');
const gray = wrap('38;5;245');

// ── spinner ──────────────────────────────────────────────────────────────────
class Spinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private i = 0;
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  start(label: string): void {
    if (!tty) return;
    this.stop();
    this.timer = setInterval(() => {
      stdout.write(`\r${coral(this.frames[this.i = (this.i + 1) % this.frames.length]!)} ${dim(label)}   `);
    }, 80);
  }
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; stdout.write('\r\x1b[K'); }
  }
}

function renderStep(s: AgentStep): void {
  const arg = Object.values(s.args)[0];
  const argStr = arg ? ` ${gray(String(arg).slice(0, 60))}` : '';
  stdout.write(`  ${coral('→')} ${bold(s.tool)}${argStr}\n`);
}

function renderResult(r: AgentResult): void {
  stdout.write(`\n${r.output.trim()}\n`);
}

function makeCtx(brain: Brain, fabric: ToolFabric, scopes: string[], spin: Spinner): AgentContext {
  return {
    brain, fabric, scopes,
    onStatus: () => spin.start('thinking'),
    onStep: (step) => { spin.stop(); renderStep(step); },
  };
}

async function runOnce(agent: Agent, ctx: AgentContext, task: string, spin: Spinner): Promise<void> {
  try {
    const r = await tracedRun(agent, task, ctx);
    spin.stop();
    renderResult(r);
  } catch (err) {
    spin.stop();
    stdout.write(`${coral('✗')} ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function parseFlags(argv: string[]): {
  agent: AgentKind;
  scopes: string[];
  saved: string | null;
  fresh: boolean;
  rest: string[];
} {
  let agent: AgentKind = 'auto';
  let scopes = [config.demoUserAccessScope];
  let saved: string | null = null;
  let fresh = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') agent = (argv[++i] as AgentKind) ?? 'auto';
    else if (argv[i] === '--scopes') scopes = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--saved') saved = (argv[++i] ?? '').trim() || null;
    else if (argv[i] === '--fresh') fresh = true;
    else rest.push(argv[i]!);
  }
  return { agent, scopes, saved, fresh, rest };
}

/**
 * Cache + budget options for a saved-agent run. The token budget always meters;
 * the response cache only attaches on the deterministic (`--fresh`, memory-less)
 * path, since a context-retaining prompt is unique per turn and never cacheable.
 */
function tokenOpts(fresh: boolean): SavedAgentOptions {
  return {
    budget: getTokenBudget(config.comb.dataDir),
    budgetLimit: config.comb.tokenBudgetPerScope,
    cacheModel: config.ollama.generationModel,
    memoryTokenBudget: config.comb.memoryTokenBudget,
    ...(fresh ? { cache: getResponseCache(config.comb.dataDir, config.comb.cacheTtlSeconds) } : {}),
  };
}

/**
 * Resolve which agent to run: an explicit saved agent (by id or name) wins over
 * the generic builtin/tools kinds. Exits with a clear message if a `--saved`
 * name doesn't resolve — never silently falls back to a different agent.
 */
async function chooseAgent(kind: AgentKind, saved: string | null, fresh: boolean): Promise<Agent> {
  if (!saved) return pickAgent(kind);
  const def = await resolveAgent(getCustomAgentStore(), saved);
  if (!def) {
    stdout.write(`${coral('✗')} no saved agent matches ${bold(saved)} — see ${bold('comb agents')}.\n`);
    process.exit(1);
  }
  // Default: a saved agent retains context across runs/sessions (bound memory).
  // `--fresh`: a stateless, deterministic run — no memory, response-cached.
  const opts = tokenOpts(fresh);
  if (!fresh) opts.memory = bindMemory(getConversationStore(), def.id);
  return new SavedAgent(def, opts);
}

/** `comb budget [--scopes a,b]` — show token usage against the per-scope cap. */
async function showBudget(scopes: string[]): Promise<void> {
  const key = scopeKey(scopes);
  const used = await getTokenBudget(config.comb.dataDir).usage(key);
  const limit = config.comb.tokenBudgetPerScope;
  stdout.write(`\n${butter('◆')} ${bold('Token budget')} ${dim(`· scope "${key}"`)}\n`);
  stdout.write(`  ${dim('used')}   ${bold(String(used))} tokens\n`);
  stdout.write(`  ${dim('limit')}  ${limit > 0 ? `${limit} tokens` : gray('unlimited (set COMB_TOKEN_BUDGET_PER_SCOPE)')}\n`);
  if (limit > 0) stdout.write(`  ${dim('left')}   ${bold(String(Math.max(0, limit - used)))} tokens\n`);
}

const concernTag: Record<RunConcern, string> = {
  ok: '',
  refused: ' ' + butter('⚑ refused'),
  ungrounded: ' ' + coral('⚑ ungrounded'),
};

/**
 * `comb runs [--limit N] [--failed]` — recent agent runs with token + latency
 * metrics. `--failed` keeps only failure-shaped runs (refused / ungrounded) —
 * the triage queue for the prod → eval loop.
 */
async function listRuns(limit: number, failedOnly: boolean): Promise<void> {
  const all = await getRunStore().list(failedOnly ? Math.max(limit, 200) : limit);
  const runs = (failedOnly ? all.filter((r) => classifyRun(r) !== 'ok') : all).slice(0, limit);
  if (!runs.length) {
    stdout.write(failedOnly ? `${dim('No failure-shaped runs. ')}${butter('✓')}\n` : `${dim('No runs recorded yet.')} Run an agent, then check back.\n`);
    return;
  }
  stdout.write(`\n${butter('◆')} ${bold(failedOnly ? 'Flagged runs' : 'Recent runs')} ${dim(`· ${runs.length}`)}\n`);
  for (const r of runs) {
    const when = r.at.replace('T', ' ').slice(0, 19);
    stdout.write(`  ${coral('•')} ${bold(r.id)}  ${dim(when)}  ${gray(r.agent)}${concernTag[classifyRun(r)]}\n`);
    stdout.write(`    ${dim('in')} ${gray(r.input.replace(/\s+/g, ' ').slice(0, 56))}\n`);
    stdout.write(`    ${dim('tokens')} ${r.promptTokens}+${r.outputTokens}  ${dim('· tools')} ${r.steps.length}  ${dim('·')} ${r.latencyMs}ms\n`);
  }
  stdout.write(
    failedOnly
      ? `\n${dim('Lock one in as a regression:')} ${bold('comb promote <run id>')}\n`
      : `\n${dim('Inspect one:')} ${bold('comb trace <run id>')}  ${dim('· only failures:')} ${bold('comb runs --failed')}\n`,
  );
}

const DEFAULT_REGRESSION_SUITE = 'comb-regressions.json';

/**
 * `comb promote <run id> [--suite file] [--expect-refusal]` — turn a recorded
 * run into a permanent regression case appended to an eval suite. This is the
 * prod → eval loop in one command: a run that misbehaved becomes a test that
 * gates CI forever after. Run the suite with `comb eval --suite <file>`.
 */
async function promoteRun(runId: string | undefined, suitePath: string, expectRefusal: boolean): Promise<void> {
  const needle = (runId ?? '').trim();
  if (!needle) {
    stdout.write(gray('usage: comb promote <run id> [--suite file.json] [--expect-refusal]\n'));
    process.exit(1);
  }
  const run = await getRunStore().get(needle);
  if (!run) {
    stdout.write(`${coral('✗')} no run ${bold(needle)} — see ${bold('comb runs')}.\n`);
    process.exit(1);
  }
  const scenario = scenarioFromRun(run, { expectRefusal });
  // Read the existing suite (tolerate missing/empty), append, write back.
  let suite: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(await readFile(suitePath, 'utf8'));
    if (Array.isArray(parsed)) suite = parsed;
  } catch {
    // no suite yet — start a new one
  }
  suite.push(scenario);
  await writeFile(suitePath, JSON.stringify(suite, null, 2) + '\n', 'utf8');

  const expect = expectRefusal ? 'refuses' : 'cites_sources';
  stdout.write(`\n${butter('✓')} promoted ${bold(run.id)} → ${bold(suitePath)} ${dim(`(${suite.length} case${suite.length === 1 ? '' : 's'})`)}\n`);
  stdout.write(`  ${dim('asserts')} ${expect}  ${dim('· agent')} ${run.agent}  ${dim('· scopes')} ${run.scopes.join(', ')}\n`);
  stdout.write(`\n${dim('Gate on it:')} ${bold(`comb eval --suite ${suitePath}`)}\n`);
}

/** `comb trace <id>` — the full tool-call trace + metrics for one run. */
async function showTrace(id: string | undefined): Promise<void> {
  const needle = (id ?? '').trim();
  if (!needle) {
    stdout.write(gray('usage: comb trace <run id>   (see ' + bold('comb runs') + ')\n'));
    process.exit(1);
  }
  const r = await getRunStore().get(needle);
  if (!r) {
    stdout.write(`${coral('✗')} no run ${bold(needle)} — see ${bold('comb runs')}.\n`);
    process.exit(1);
  }
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Run')} ${r.id}\n${dim(line)}\n`);
  stdout.write(`${dim('agent')}    ${r.agent}\n${dim('backend')}  ${r.backend}\n${dim('scopes')}   ${r.scopes.join(', ')}\n`);
  stdout.write(`${dim('tokens')}   ${r.promptTokens} in / ${r.outputTokens} out  ${dim('· latency')} ${r.latencyMs}ms  ${dim('· at')} ${r.at}\n`);
  stdout.write(`${dim(line)}\n${dim('input')}\n  ${r.input}\n`);
  if (r.steps.length) {
    stdout.write(`${dim('steps')}\n`);
    for (const s of r.steps) {
      const arg = Object.values(s.args)[0];
      stdout.write(`  ${coral('→')} ${bold(s.tool)} ${gray(arg ? String(arg).slice(0, 48) : '')}\n`);
      stdout.write(`    ${gray(s.result.replace(/\s+/g, ' ').slice(0, 80))}\n`);
    }
  }
  stdout.write(`${dim('output')}\n  ${r.output.replace(/\n/g, '\n  ')}\n`);
}

/** `comb forget <id|name>` — wipe a saved agent's conversation memory. */
async function forgetAgent(idOrName: string | undefined): Promise<void> {
  const needle = (idOrName ?? '').trim();
  if (!needle) {
    stdout.write(gray('usage: comb forget <agent id or name>\n'));
    process.exit(1);
  }
  const def = await resolveAgent(getCustomAgentStore(), needle);
  if (!def) {
    stdout.write(`${coral('✗')} no saved agent matches ${bold(needle)} — see ${bold('comb agents')}.\n`);
    process.exit(1);
  }
  await getConversationStore().clear(def.id);
  stdout.write(`${butter('✓')} cleared memory for ${bold(def.name)}.\n`);
}

/** `comb agents` — list saved agents (the no-code definitions on this brain). */
async function listAgents(): Promise<void> {
  const agents = await getCustomAgentStore().list();
  if (!agents.length) {
    stdout.write(`${dim('No saved agents yet.')} Create one with ${bold('comb create')}.\n`);
    return;
  }
  stdout.write(`\n${butter('◆')} ${bold('Saved agents')} ${dim(`· ${agents.length}`)}\n`);
  for (const a of agents) {
    stdout.write(`  ${coral('•')} ${bold(a.name)}  ${dim(a.id)}\n`);
    stdout.write(`    ${gray(a.instruction.replace(/\s+/g, ' ').slice(0, 72))}\n`);
  }
  stdout.write(`\n${dim('Run one:')} ${bold('comb run --saved "<name>" "<request>"')}\n`);
}

/** Pull --name / --instruction / --query out of a create argv (flag form). */
function parseCreateFlags(argv: string[]): { name?: string; instruction?: string; query?: string } {
  const out: { name?: string; instruction?: string; query?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name') out.name = (argv[++i] ?? '').trim();
    else if (argv[i] === '--instruction') out.instruction = (argv[++i] ?? '').trim();
    else if (argv[i] === '--query') out.query = (argv[++i] ?? '').trim();
  }
  return out;
}

/** Persist a definition and print how to run it — shared by both create paths. */
async function saveAndReport(name: string, instruction: string, query?: string): Promise<void> {
  const agent = await getCustomAgentStore().save({ name, instruction, query: query || undefined });
  stdout.write(`\n${butter('✓')} saved ${bold(agent.name)} ${dim(agent.id)}\n`);
  stdout.write(`${dim('grounds on')}  ${gray(agent.query)}\n`);
  stdout.write(`\n${dim('Run it:')}\n`);
  stdout.write(`  ${bold(`comb run --saved "${agent.name}" "<your request>"`)}\n`);
  stdout.write(`  ${bold(`comb chat --saved "${agent.name}"`)}   ${dim('(a continuing conversation)')}\n`);
}

/**
 * `comb create` — write a saved agent. A no-code agent is just a prompt: a name,
 * the instruction it follows, and what to retrieve for grounding.
 *
 * Two forms share one save path:
 *   • flag form (scriptable / CI):  comb create --name N --instruction I [--query Q]
 *   • interactive wizard (a TTY):   step-by-step Q&A
 * Flags win when present; we only fall to the wizard when they're incomplete.
 */
async function createAgent(argv: string[]): Promise<void> {
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Create an agent')} ${dim('· no code, just a prompt')}\n${dim(line)}\n`);

  // Flag form — works in any shell, including non-interactive CI.
  const flags = parseCreateFlags(argv);
  if (flags.name && flags.instruction) {
    return saveAndReport(flags.name, flags.instruction, flags.query);
  }

  if (!stdin.isTTY) {
    stdout.write(gray('create needs a terminal, or pass flags:\n'));
    stdout.write(gray('  comb create --name "<name>" --instruction "<what it does>" [--query "<grounding>"]\n'));
    process.exit(1);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const name = (flags.name ?? (await rl.question(`${dim('name')}         ${coral('›')} `))).trim();
    if (!name) {
      stdout.write(`${coral('✗')} a name is required.\n`);
      process.exit(1);
    }
    stdout.write(`${dim('instruction')}  ${gray('what should it do? (one or more lines)')}\n`);
    const instruction = (flags.instruction ?? (await rl.question(`             ${coral('›')} `))).trim();
    if (!instruction) {
      stdout.write(`${coral('✗')} an instruction is required.\n`);
      process.exit(1);
    }
    const query = (flags.query ?? (await rl.question(
      `${dim('retrieval')}    ${gray('what to search for grounding (Enter = use the name)')} ${coral('›')} `,
    ))).trim();
    await saveAndReport(name, instruction, query);
  } finally {
    await rl.close();
  }
}

function banner(agent: Agent, fabric: ToolFabric, scopes: string[]): void {
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Comb')} ${dim('· your agentic OS harness')}\n${dim(line)}\n`);
  stdout.write(`${dim('agent')}   ${agent.name}\n`);
  stdout.write(`${dim('mode')}    ${describeMode()}\n`);
  stdout.write(`${dim('scopes')}  ${scopes.join(', ')}\n`);
  stdout.write(`${dim('tools')}   ${fabric.list().length} available  ${dim('(' + fabric.list().map((t) => t.id).slice(0, 6).join(', ') + '…)')}\n`);
  const cap = config.comb.tokenBudgetPerScope;
  stdout.write(`${dim('window')}  ${config.comb.contextWindowTokens} tok  ${dim('· memory ≤')} ${config.comb.memoryTokenBudget} tok  ${dim('· budget')} ${cap > 0 ? cap + ' tok/scope' : 'unlimited'}\n`);
  stdout.write(`${dim(line)}\n${dim('Type a task, or')} ${bold('exit')}${dim('.')}\n`);
}

async function main(): Promise<void> {
  const [mode, ...argv] = process.argv.slice(2);
  const { agent: kind, scopes, saved, fresh, rest } = parseFlags(argv);
  const spin = new Spinner();

  // Registry-only commands: no brain/fabric assembly needed.
  if (mode === 'create') return createAgent(argv);
  if (mode === 'agents') return listAgents();
  if (mode === 'forget') return forgetAgent(rest[0]);
  if (mode === 'budget') return showBudget(scopes);
  if (mode === 'runs') {
    const li = argv.indexOf('--limit');
    return listRuns(li !== -1 ? Math.max(1, Number(argv[li + 1]) || 20) : 20, argv.includes('--failed'));
  }
  if (mode === 'trace') return showTrace(rest[0]);
  if (mode === 'promote') {
    const si = argv.indexOf('--suite');
    const runId = argv.find((a) => a.startsWith('run_')) ?? rest[0];
    return promoteRun(runId, si !== -1 ? (argv[si + 1] ?? DEFAULT_REGRESSION_SUITE) : DEFAULT_REGRESSION_SUITE, argv.includes('--expect-refusal'));
  }

  const brain = await Brain.create();
  const fabric = await createFabric(brain);
  const agent = await chooseAgent(kind, saved, fresh);
  const ctx = makeCtx(brain, fabric, scopes, spin);

  if (mode === 'chat') {
    banner(agent, fabric, scopes);
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      for (;;) {
        const line = (await rl.question(`\n${coral('›')} `)).trim();
        if (!line || line === 'exit' || line === 'quit') break;
        await runOnce(agent, ctx, line, spin);
      }
    } finally {
      await rl.close();
      await fabric.close();
    }
    stdout.write(dim('\nbye.\n'));
    return;
  }

  // one-shot
  const task = rest.join(' ').trim();
  if (!task) {
    stdout.write(gray('usage: comb run "<task>" [--agent auto|builtin|tools] [--scopes a,b]\n'));
    await fabric.close();
    process.exit(1);
  }
  stdout.write(`${dim('agent')} ${agent.name}  ${dim('· scopes')} ${scopes.join(',')}  ${dim('· ' + fabric.list().length + ' tools')}\n`);
  await runOnce(agent, ctx, task, spin);
  await fabric.close();
}

main().catch((err: unknown) => {
  stdout.write(`${coral('✗')} ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
