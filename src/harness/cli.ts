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
    const r = await agent.run(task, ctx);
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

/**
 * `comb create` — step-by-step Q&A that writes a saved agent. A no-code agent is
 * just a prompt: a name, the instruction it follows, and what to retrieve for
 * grounding. We collect those, save through the shared registry (file-backed by
 * default, so it survives the process), and print how to run it.
 */
async function createAgent(): Promise<void> {
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Create an agent')} ${dim('· no code, just a prompt')}\n${dim(line)}\n`);
  if (!stdin.isTTY) {
    stdout.write(gray('create needs an interactive terminal. Or POST /api/agents.\n'));
    process.exit(1);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const name = (await rl.question(`${dim('name')}         ${coral('›')} `)).trim();
    if (!name) {
      stdout.write(`${coral('✗')} a name is required.\n`);
      process.exit(1);
    }
    stdout.write(`${dim('instruction')}  ${gray('what should it do? (one or more lines)')}\n`);
    const instruction = (await rl.question(`             ${coral('›')} `)).trim();
    if (!instruction) {
      stdout.write(`${coral('✗')} an instruction is required.\n`);
      process.exit(1);
    }
    const query = (await rl.question(
      `${dim('retrieval')}    ${gray('what to search for grounding (Enter = use the name)')} ${coral('›')} `,
    )).trim();

    const agent = await getCustomAgentStore().save({ name, instruction, query: query || undefined });
    stdout.write(`\n${butter('✓')} saved ${bold(agent.name)} ${dim(agent.id)}\n`);
    stdout.write(`${dim('grounds on')}  ${gray(agent.query)}\n`);
    stdout.write(`\n${dim('Run it:')}\n`);
    stdout.write(`  ${bold(`comb run --saved "${agent.name}" "<your request>"`)}\n`);
    stdout.write(`  ${bold(`comb chat --saved "${agent.name}"`)}   ${dim('(a continuing conversation)')}\n`);
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
  if (mode === 'create') return createAgent();
  if (mode === 'agents') return listAgents();
  if (mode === 'forget') return forgetAgent(rest[0]);
  if (mode === 'budget') return showBudget(scopes);

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
