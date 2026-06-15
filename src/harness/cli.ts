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
import { NO_MODEL_MESSAGE } from '../agents/generator.js';
import { createFabric } from '../tools/assemble.js';
import { pickAgent, type AgentKind } from './run.js';
import { getCustomAgentStore, resolveAgent, type CustomAgent } from '../agents/registry.js';
import { bindMemory, getConversationStore } from '../agents/conversation.js';
import { parseChatCommand, CHAT_HELP } from './chat-commands.js';
import { ToolLoopAgent } from './agent.js';
import { draftAgent } from '../agents/architect.js';
import { buildBirthKit, saveBirthKit, commission } from '../agents/lifecycle.js';
import { getIntentStore, type IntentKind } from '../intents/registry.js';
import { getSkillStore } from '../skills/registry.js';
import { listDivergences, listCandidates } from '../divergence/engine.js';
import { DEMO_COMPANY } from '../seed/demo-company.js';
import { isUrl, fetchUrl } from '../connectors/url.js';
import { ActionService as ActionSvc } from '../actions/service.js';
import { runAgentEval } from '../eval/agent-run.js';
import { resolveContextWindow, FALLBACK_WINDOW, type ResolvedWindow } from './context-window.js';
import { ActionService } from '../actions/service.js';
import { getResponseCache } from './cache.js';
import { getTokenBudget, scopeKey } from './tokens.js';
import { SavedAgent, type SavedAgentOptions } from './saved-agent.js';
import { getRunStore, tracedRun, classifyRun, type RunConcern } from '../observability/runs.js';
import { scenarioFromRun } from '../eval/agent-eval.js';
import { createMemoryStore } from '../brain/memory.js';
import {
  activeEmbeddingModel,
  chooseFloor,
  saveCalibration,
  type CalibrationPoint,
  type LabeledQuery,
} from '../brain/grounding.js';
import { readFile, writeFile, rm, stat } from 'node:fs/promises';
import { collectFiles, formatFor, baseName } from './ingest-files.js';
import pg from 'pg';
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
  act: boolean;
  rest: string[];
} {
  let agent: AgentKind = 'auto';
  let scopes = [config.demoUserAccessScope];
  let saved: string | null = null;
  let fresh = false;
  let act = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') agent = (argv[++i] as AgentKind) ?? 'auto';
    else if (argv[i] === '--scopes') scopes = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--saved') saved = (argv[++i] ?? '').trim() || null;
    else if (argv[i] === '--fresh') fresh = true;
    else if (argv[i] === '--act') act = true;
    else rest.push(argv[i]!);
  }
  return { agent, scopes, saved, fresh, act, rest };
}

/**
 * The active model's context window — resolved ONCE per process in main()
 * (dynamic: Ollama introspection → known-models table → safe default), then
 * read by every agent build. Falls back conservatively if read before resolve.
 */
let windowInfo: ResolvedWindow = {
  tokens: FALLBACK_WINDOW,
  source: 'default',
  memoryTokens: Math.floor(FALLBACK_WINDOW * config.comb.memoryWindowFraction),
};

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
    memoryTokenBudget: windowInfo.memoryTokens,
    ...(fresh ? { cache: getResponseCache(config.comb.dataDir, config.comb.cacheTtlSeconds) } : {}),
  };
}

/**
 * Resolve which agent to run: an explicit saved agent (by id or name) wins over
 * the generic builtin/tools kinds. Exits with a clear message if a `--saved`
 * name doesn't resolve — never silently falls back to a different agent.
 */
/**
 * Resolve a `/agent` switch inside chat: a generic kind or a saved agent by
 * name/id (memory-bound). Returns null on a miss — chat prints an error and
 * keeps the session alive (never process.exit mid-conversation).
 */
async function switchChatAgent(arg: string): Promise<{ agent: Agent; def: CustomAgent | null } | null> {
  if (!arg) return null;
  if (arg === 'builtin' || arg === 'tools' || arg === 'auto') {
    return { agent: pickAgent(arg), def: null };
  }
  const def = await resolveAgent(getCustomAgentStore(), arg);
  if (!def || !def.enabled || !def.commissioned) return null;
  const opts = tokenOpts(false);
  opts.memory = bindMemory(getConversationStore(), def.id);
  return { agent: new SavedAgent(def, opts), def };
}

async function chooseAgent(kind: AgentKind, saved: string | null, fresh: boolean): Promise<Agent> {
  if (!saved) return pickAgent(kind);
  const def = await resolveAgent(getCustomAgentStore(), saved);
  if (!def) {
    stdout.write(`${coral('✗')} no saved agent matches ${bold(saved)} — see ${bold('comb agents')}.\n`);
    process.exit(1);
  }
  // THE RUNNABLE-GATE: a draft (uncommissioned) or benched agent cannot run.
  // "Born tested" — it must pass its birth-kit evals first.
  if (!def.enabled) {
    stdout.write(`${coral('✗')} ${bold(def.name)} is disabled.\n`);
    process.exit(1);
  }
  if (!def.commissioned) {
    stdout.write(`${coral('✗')} ${bold(def.name)} is a DRAFT — it must pass its birth evals first:\n`);
    stdout.write(`  ${bold(`comb commission "${def.name}"`)}\n`);
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

const statusBadge: Record<string, string> = {
  proposed: butter('● awaiting approval'),
  executed: '✓ executed',
  rejected: gray('✗ rejected'),
  failed: coral('✗ failed'),
};

/**
 * `comb actions [--all]` — THE human-in-the-loop queue. Default shows only
 * actions awaiting a decision; --all includes the decided history. The store
 * is file-backed on real backends, so this CLI sees the same queue the server
 * process writes to.
 */
async function listActions(showAll: boolean): Promise<void> {
  const svc = ActionService.create(await Brain.create());
  const all = await svc.list();
  const rows = showAll ? all : all.filter((a) => a.status === 'proposed');
  if (!rows.length) {
    stdout.write(showAll ? `${dim('No actions recorded yet.')}\n` : `${dim('Nothing awaiting approval. ')}${butter('✓')}\n`);
    return;
  }
  stdout.write(`\n${butter('◆')} ${bold(showAll ? 'Actions' : 'Awaiting your approval')} ${dim(`· ${rows.length}`)}\n`);
  for (const a of rows) {
    stdout.write(`  ${coral('•')} ${bold(a.id.slice(0, 8))}  ${statusBadge[a.status] ?? a.status}  ${gray(a.title)}\n`);
    stdout.write(`    ${gray(a.body.replace(/\s+/g, ' ').slice(0, 76))}\n`);
    stdout.write(`    ${dim('grounded on')} ${[...new Set(a.sources.map((s) => s.source))].join(', ')}  ${dim('·')} ${dim(a.createdAt.slice(0, 19).replace('T', ' '))}\n`);
  }
  stdout.write(`\n${dim('Decide:')} ${bold('comb approve <id>')} ${dim('·')} ${bold('comb reject <id> [reason]')}\n`);
}

/** Resolve a (possibly shortened) action id against the queue. */
async function findAction(svc: ActionService, idArg: string | undefined): Promise<string | null> {
  const needle = (idArg ?? '').trim();
  if (!needle) return null;
  const all = await svc.list();
  const hit = all.find((a) => a.id === needle) ?? all.find((a) => a.id.startsWith(needle));
  return hit?.id ?? null;
}

/** `comb approve <id>` — the human decision that lets a side effect happen. */
async function approveAction(idArg: string | undefined): Promise<void> {
  const svc = ActionService.create(await Brain.create());
  const id = await findAction(svc, idArg);
  if (!id) {
    stdout.write(gray('usage: comb approve <action id>   (see comb actions)\n'));
    process.exit(1);
  }
  const r = await svc.approve(id);
  if (!r.ok) {
    stdout.write(`${coral('✗')} ${r.reason}\n`);
    process.exit(1);
  }
  stdout.write(`${butter('✓')} ${bold(r.action.title)} → ${r.action.effect ?? r.action.status}\n`);
}

/** `comb reject <id> [reason]` — decline; the draft becomes negative feedback. */
async function rejectAction(idArg: string | undefined, reason: string): Promise<void> {
  const svc = ActionService.create(await Brain.create());
  const id = await findAction(svc, idArg);
  if (!id) {
    stdout.write(gray('usage: comb reject <action id> [reason]\n'));
    process.exit(1);
  }
  const r = await svc.reject(id, reason || undefined);
  if (!r.ok) {
    stdout.write(`${coral('✗')} ${r.reason}\n`);
    process.exit(1);
  }
  stdout.write(`${butter('✓')} rejected ${bold(r.action.title)}${reason ? dim(` — ${reason}`) : ''}\n`);
}

/**
 * `comb calibrate --labels file.json [--scopes a,b]` — place the grounding
 * floor FROM DATA instead of a hardcoded 0.5. Retrieves every labeled query
 * with NO floor (so the full score distribution is visible), sweeps candidate
 * floors, picks the one that best separates answerable from unanswerable, and
 * stores it per embedding model. The Brain uses it on the next boot.
 */
async function calibrate(argv: string[], scopes: string[]): Promise<void> {
  const li = argv.indexOf('--labels');
  const labelsPath = li !== -1 ? argv[li + 1] : undefined;
  if (!labelsPath) {
    stdout.write(gray('usage: comb calibrate --labels labels.json [--scopes a,b]\n'));
    stdout.write(gray('labels.json: [{ "query": "...", "answerable": true|false }, ...]\n'));
    process.exit(1);
  }
  if (config.backend === 'mock') {
    stdout.write(`${coral('✗')} calibration is for live backends — the mock keyword path already refuses on no-match.\n`);
    process.exit(1);
  }
  const parsed: unknown = JSON.parse(await readFile(labelsPath, 'utf8'));
  const labels = (Array.isArray(parsed) ? parsed : []) as LabeledQuery[];
  const valid = labels.filter((l) => l && typeof l.query === 'string' && typeof l.answerable === 'boolean');
  if (valid.length < 4) {
    stdout.write(`${coral('✗')} need at least 4 labeled queries (mix of answerable + unanswerable).\n`);
    process.exit(1);
  }

  const model = activeEmbeddingModel();
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Calibrate grounding floor')} ${dim(`· ${model}`)}\n${dim(line)}\n`);

  // Floor-less retrieval: we need to SEE the noise scores to place the floor.
  const memory = createMemoryStore({ minScoreOverride: 0 });
  const points: CalibrationPoint[] = [];
  for (const l of valid) {
    const chunks = await memory.retrieve({ query: l.query, accessScopes: scopes, topK: 8 });
    const bestScore = chunks.length ? Math.max(...chunks.map((c) => c.score)) : 0;
    points.push({ query: l.query, answerable: l.answerable, bestScore });
    const tag = l.answerable ? butter('answerable  ') : gray('unanswerable');
    stdout.write(`  ${tag} ${bestScore.toFixed(3)}  ${gray(l.query.slice(0, 48))}\n`);
  }

  const result = chooseFloor(points);
  await saveCalibration(config.comb.dataDir, model, {
    floor: result.floor,
    answerableRecall: result.answerableRecall,
    unanswerableRefusal: result.unanswerableRefusal,
    samples: valid.length,
    calibratedAt: new Date().toISOString(),
  });

  stdout.write(`${dim(line)}\n`);
  stdout.write(`${butter('✓')} floor ${bold(result.floor.toFixed(2))} ${dim(`(was ${config.ollama.minScore} default)`)}\n`);
  stdout.write(`  ${dim('answerable recall')}     ${(result.answerableRecall * 100).toFixed(0)}%\n`);
  stdout.write(`  ${dim('unanswerable refusal')}  ${(result.unanswerableRefusal * 100).toFixed(0)}%\n`);
  if (result.answerableRecall < 1 || result.unanswerableRefusal < 1) {
    stdout.write(`  ${gray('imperfect separation — add more labeled queries or improve the corpus.')}\n`);
  }
  stdout.write(`\n${dim('Stored per-model; the brain uses it on next run. Re-run after changing the embedding model or growing the data.')}\n`);
}

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

/**
 * `comb commission <id|name>` — THE GATE. Runs the agent's birth-kit starter
 * suite; a full pass flips commissioned=true and the agent becomes runnable.
 * A failing agent stays a draft ("born tested" — nobody ships untested).
 */
async function commissionAgent(idOrName: string | undefined): Promise<void> {
  const needle = (idOrName ?? '').trim();
  if (!needle) {
    stdout.write(gray('usage: comb commission <agent id or name>\n'));
    process.exit(1);
  }
  const store = getCustomAgentStore();
  const def = await resolveAgent(store, needle);
  if (!def) {
    stdout.write(`${coral('✗')} no saved agent matches ${bold(needle)} — see ${bold('comb agents')}.\n`);
    process.exit(1);
  }
  if (def.commissioned) {
    stdout.write(`${butter('✓')} ${bold(def.name)} is already commissioned.\n`);
    return;
  }
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Commissioning')} ${def.name} ${dim('· running its birth evals')}\n${dim(line)}\n`);
  const outcome = await commission(def, store, runAgentEval);
  if (outcome.grandfathered) {
    stdout.write(`${butter('✓')} no birth kit found (legacy agent) — commissioned directly.\n`);
    return;
  }
  for (const r of outcome.results) {
    stdout.write(`  ${r.passed ? butter('✓') : coral('✗')} ${r.name}\n`);
    if (!r.passed) {
      for (const t of r.turns) for (const c of t.checks) {
        if (c.status === 'fail') stdout.write(`      ${coral('✗')} ${c.check}${c.detail ? dim(` — ${c.detail}`) : ''}\n`);
      }
    }
  }
  stdout.write(`${dim(line)}\n`);
  if (outcome.passed) {
    stdout.write(`${butter('✓ COMMISSIONED')} — ${bold(def.name)} is now runnable: ${bold(`comb run --saved "${def.name}" "<request>"`)}\n`);
  } else {
    stdout.write(`${coral('✗ STILL A DRAFT')} — fix the data (ingest more) or the definition, then re-run ${bold('comb commission')}.\n`);
    process.exit(1);
  }
}

/**
 * `comb intent "<statement>" [--kind goal|spec|policy|procedure]` — declare
 * WHAT SHOULD BE HAPPENING. Intents are the closed loop's reference signal:
 * the divergence engine compares reality streams against them.
 */
async function declareIntent(rest: string[], argv: string[], scopes: string[]): Promise<void> {
  // parseFlags only consumes known global flags; strip intent-local ones here
  // so "--kind goal" never leaks into the statement text.
  const statement: string = (() => {
    const out: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--kind') { i++; continue; }
      out.push(rest[i]!);
    }
    return out.join(' ');
  })();
  if (!statement.trim()) {
    stdout.write(gray('usage: comb intent "<what should happen>" [--kind goal|spec|policy|procedure] [--scopes a,b]\n'));
    process.exit(1);
  }
  const ki = argv.indexOf('--kind');
  const kind = (ki !== -1 ? argv[ki + 1] : 'goal') as IntentKind;
  const it = await getIntentStore().save({ statement, kind, scopes });
  stdout.write(`${butter('✓')} intent ${bold(it.id)} ${dim(`· ${it.kind} · v${it.version} · scopes ${it.scopes.join(',')}`)}\n  ${gray(it.statement)}\n`);
}

/**
 * `comb skill "<name>" --body "<how it's done>" [--triggers a,b]` — record HOW
 * work is done here (Blomfield's executable skill). Trigger-matched, model-free.
 */
async function recordSkill(rest: string[], argv: string[], scopes: string[]): Promise<void> {
  const bi = argv.indexOf('--body');
  const ti = argv.indexOf('--triggers');
  const name = (() => {
    const out: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--body' || rest[i] === '--triggers') { i++; continue; }
      out.push(rest[i]!);
    }
    return out.join(' ');
  })();
  const body = bi !== -1 ? (argv[bi + 1] ?? '') : '';
  if (!name.trim() || !body.trim()) {
    stdout.write(gray('usage: comb skill "<name>" --body "<how it is done>" [--triggers a,b] [--scopes x]\n'));
    process.exit(1);
  }
  const triggers = ti !== -1 ? (argv[ti + 1] ?? '').split(',').map((t) => t.trim()).filter(Boolean) : undefined;
  const sk = await getSkillStore().save({ name, body, triggers, scopes });
  stdout.write(`${butter('✓')} skill ${bold(sk.id)} ${dim(`· triggers: ${sk.triggers.join(', ')}`)}\n  ${gray(sk.name)}\n`);
}

/** `comb skills [query]` — list, or trigger-match a query against, the skills. */
async function listSkills(rest: string[], scopes: string[]): Promise<void> {
  const query = rest.join(' ').trim();
  const all = query ? await getSkillStore().find(query, scopes) : await getSkillStore().list(scopes);
  if (!all.length) {
    stdout.write(query ? `${dim('No skill matches')} ${bold(query)}.\n` : `${dim('No skills recorded.')} ${bold('comb skill "<name>" --body "..."')}\n`);
    return;
  }
  stdout.write(`\n${butter('◆')} ${bold(query ? `Skills for "${query}"` : 'Skills')} ${dim(`· ${all.length} (how work is done)`)}\n`);
  for (const sk of all) {
    stdout.write(`  ${coral('•')} ${bold(sk.name)}  ${dim(sk.id)} ${dim(`· uses ${sk.uses}`)}\n    ${gray('triggers: ' + sk.triggers.join(', '))}\n    ${gray(sk.body.replace(/\s+/g, ' ').slice(0, 80))}\n`);
  }
}

/** `comb intents` — list the reference signals reality is compared against. */
async function listIntents(scopes: string[]): Promise<void> {
  const all = await getIntentStore().list(scopes);
  if (!all.length) {
    stdout.write(`${dim('No intents declared.')} ${bold('comb intent "<what should happen>"')}\n`);
    return;
  }
  stdout.write(`\n${butter('◆')} ${bold('Intents')} ${dim(`· ${all.length} (what SHOULD be happening)`)}\n`);
  for (const i of all) {
    stdout.write(`  ${i.enabled ? coral('•') : gray('◦')} ${bold(i.id)}  ${dim(`${i.kind} · v${i.version}`)}\n    ${gray(i.statement.slice(0, 76))}\n`);
  }
}

/** `comb divergences` — the COMPARE stage's verdicts (flags + silent record). */
async function showDivergences(): Promise<void> {
  // Two layers: model-free CANDIDATES (always detected at ingest, the host
  // judges) and model-judged VERDICTS (only on a model-capable backend). The
  // candidates are the part that works with no model, so surface them first —
  // without this the CLI looked empty on the model-free default.
  const [candidates, all] = await Promise.all([listCandidates(undefined, 20), listDivergences(20)]);
  if (!candidates.length && !all.length) {
    stdout.write(`${dim('No divergence checks yet. Declare an intent FIRST, then ingest reality:')}\n`);
    stdout.write(`${dim('  comb intent "..." --kind policy   then   comb ingest <reality>')}\n`);
    return;
  }
  if (candidates.length) {
    stdout.write(`\n${butter('◆')} ${bold('Divergence candidates')} ${dim(`· ${candidates.length} · model-free — you judge`)}\n`);
    for (const c of candidates) {
      stdout.write(`  ${coral('⚑')} ${gray(`intent: ${c.intentStatement.slice(0, 50)}`)} ${dim(`(overlap ${(c.overlap * 100).toFixed(0)}%)`)}\n`);
      stdout.write(`    ${dim(`reality (${c.source}):`)} ${gray(c.evidence.slice(0, 74))}\n`);
    }
  }
  if (!all.length) return;
  stdout.write(`\n${butter('◆')} ${bold('Divergence verdicts')} ${dim(`· ${all.length} · model-judged`)}\n`);
  for (const d of all) {
    const badge = d.status === 'diverged' ? coral('⚑ DIVERGED') : d.status === 'aligned' ? butter('✓ aligned') : gray('· silent');
    stdout.write(`  ${badge}  ${dim(d.at.slice(0, 19).replace('T', ' '))}  ${gray(`intent: ${d.intentStatement.slice(0, 48)}`)}\n`);
    if (d.status === 'diverged') {
      stdout.write(`    ${dim('evidence')} ${gray((d.evidence[0] ?? '').slice(0, 70))}\n`);
      stdout.write(`    ${dim('why')} ${gray(d.rationale.slice(0, 76))}${d.actionId ? dim(`  → action ${d.actionId.slice(0, 8)} (comb actions)`) : ''}\n`);
    }
  }
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
    const badge = !a.enabled ? coral('✗ disabled') : a.commissioned ? '✓' : butter('● draft — comb commission');
    stdout.write(`  ${coral('•')} ${bold(a.name)}  ${dim(a.id)}  ${badge}\n`);
    stdout.write(`    ${gray(a.instruction.replace(/\s+/g, ' ').slice(0, 72))}\n`);
  }
  stdout.write(`\n${dim('Run one:')} ${bold('comb run --saved "<name>" "<request>"')}\n`);
}

/**
 * `comb ingest <file> [--source name] [--scope s]` — feed the brain from the
 * CLI, no server needed. Format is inferred from the extension (.csv/.json,
 * else text). Same governed path as the HTTP webhook: chunk → embed → store
 * with the caller's scope; fan-out reactions run if configured.
 */
async function ingestFile(argv: string[], scopes: string[]): Promise<void> {
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] ?? '').startsWith('--'));
  const target = positional[0];
  if (!target) {
    stdout.write(gray('usage: comb ingest <file|folder|url> [--source name] [--scope s]\n'));
    process.exit(1);
  }
  const si = argv.indexOf('--source');
  const sci = argv.indexOf('--scope');
  const sourceOverride = si !== -1 ? (argv[si + 1] ?? '') : undefined;
  const scope = sci !== -1 ? (argv[sci + 1] ?? '') : scopes[0]!;

  // Resolve the work list: a URL, a directory of docs, or a single file. A
  // folder is the obvious first move ("point it at my docs"), so support it.
  let files: string[];
  const url = isUrl(target);
  if (url) {
    files = [target];
  } else {
    const info = await stat(target);
    files = info.isDirectory() ? await collectFiles(target) : [target];
    if (!files.length) {
      stdout.write(gray(`no .txt/.md/.csv/.json files under ${target}\n`));
      return;
    }
  }

  const brain = await Brain.create();
  const spin = new Spinner();
  let total = 0;
  let reactions = 0;
  for (const f of files) {
    let content: string;
    let format: 'text' | 'csv' | 'json';
    let source: string;
    if (url) {
      const page = await fetchUrl(f);
      content = page.text;
      format = 'text';
      source = sourceOverride ?? page.source;
    } else {
      format = formatFor(f);
      content = await readFile(f, 'utf8');
      source = sourceOverride ?? baseName(f);
    }
    spin.start(`embedding ${f}`);
    const r = await brain.ingest({ format, content, source, scope }, [scope]);
    spin.stop();
    total += r.ingested;
    reactions += r.reactions.length;
    if (files.length > 1) stdout.write(`  ${butter('✓')} ${dim(`${baseName(f)} (${r.ingested})`)}\n`);
  }
  const from = files.length === 1 ? '' : ` ${dim(`from ${files.length} files`)}`;
  stdout.write(`${butter('✓')} ingested ${bold(String(total))} record${total === 1 ? '' : 's'}${from}  ${dim(`· scope=${scope}`)}\n`);
  if (reactions) stdout.write(`  ${dim('fan-out reactions ran:')} ${reactions}\n`);
  // Honest next step: model-free, the connected agent answers (comb run would
  // refuse without a model). Only point at comb run when a model is configured.
  if (config.generationEnabled) {
    stdout.write(`${dim('Ask about it:')} ${bold(`comb run "<question>" --scopes ${scope}`)}\n`);
  } else {
    stdout.write(`${dim('Now ask in your connected AI tool')} ${bold('(it calls search_brain)')}${dim(` — or set a model (LLM_BACKEND=local/openai) to use `)}${bold('comb run')}.\n`);
  }
}

/**
 * `comb reset [--all] [--yes]` — clean slate so you can ingest YOUR data.
 * Default: wipe knowledge + the closed-loop state (chunks, intents,
 * divergences, runs, conversations), KEEP your saved agents + calibration.
 * --all also wipes agents, birth kits, budgets, cache, and calibration.
 */
async function resetBrain(argv: string[]): Promise<void> {
  const all = argv.includes('--all');
  const yes = argv.includes('--yes');
  if (!yes && stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    const what = all ? 'EVERYTHING (knowledge, agents, calibration, history)' : 'knowledge + loop state (agents kept)';
    const ans = (await rl.question(`${coral('⚠')}  Reset ${bold(what)}? type ${bold('yes')}: `)).trim();
    await rl.close();
    if (ans !== 'yes') { stdout.write(dim('aborted.\n')); return; }
  }
  // Postgres tables (local/openai backend).
  const pgUrl = config.ollama.vectorDatabaseUrl;
  if (pgUrl) {
    const pool = new pg.Pool({ connectionString: pgUrl });
    const tables = ['brain_chunks', 'intents', 'agent_runs', 'agent_conversations', ...(all ? ['custom_agents'] : [])];
    for (const t of tables) {
      try { await pool.query(`TRUNCATE ${t}`); } catch { /* table may not exist yet */ }
    }
    await pool.end();
  }
  // File-tier state under the data dir.
  const dir = config.comb.dataDir;
  const always = ['divergences.json', 'runs.json', 'intents.json', 'conversations.json', 'actions.json', 'action-audit.json', 'brain_chunks.json'];
  const allOnly = ['agents.json', 'calibration.json', 'token-usage.json', 'response-cache.json', 'birthkits'];
  for (const f of [...always, ...(all ? allOnly : [])]) {
    await rm(`${dir}/${f}`, { recursive: true, force: true });
  }
  stdout.write(`${butter('✓')} reset complete — ${all ? 'everything wiped' : 'knowledge + loop cleared, agents kept'}. Ingest your data: ${bold('comb ingest <file|url>')}\n`);
}

/**
 * `comb demo-data [--scope s]` — load the Northwind Robotics sample corpus
 * (12 docs, mixed formats) into the REAL backend so the pipeline can be tried
 * at slightly larger scale without your own data. Replace it with yours later.
 */
async function loadDemoData(scopes: string[]): Promise<void> {
  const scope = scopes[0]!;
  const brain = await Brain.create();
  const spin = new Spinner();
  let total = 0;
  let flags = 0;
  for (const doc of DEMO_COMPANY) {
    spin.start(`embedding ${doc.source}`);
    const r = await brain.ingest({ format: doc.format, content: doc.content, source: doc.source, scope }, [scope]);
    spin.stop();
    total += r.ingested;
    flags += r.divergences;
    stdout.write(`  ${butter('✓')} ${bold(doc.source)} ${dim(`(${doc.format}, ${r.ingested} record${r.ingested === 1 ? '' : 's'})`)}\n`);
  }
  stdout.write(`\n${butter('◆')} loaded ${bold(String(total))} records into scope ${bold(scope)}${flags ? dim(` · ${flags} divergence flag(s)`) : ''}\n`);
  stdout.write(`${dim('Try:')} ${bold('comb run --agent builtin "What is the refund approval over $10,000?"')}\n`);
}

/**
 * `comb new "<what you want>"` — one prompt builds the whole agent surface:
 * the model (or a deterministic fallback) drafts the definition, we save it,
 * write a starter calibration-label file for it, and print every next step.
 * This is the "just describe it" path; `comb create` remains the manual one.
 */
async function newAgent(wish: string): Promise<void> {
  const trimmed = wish.trim();
  if (!trimmed) {
    stdout.write(gray('usage: comb new "<describe the agent you want>"\n'));
    process.exit(1);
  }
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Build an agent from a prompt')}\n${dim(line)}\n`);

  const draft = await draftAgent(trimmed);
  // v2 creation spine: born as a DRAFT with its birth kit; commissioning gates.
  const agent = await getCustomAgentStore().save({
    name: draft.name,
    instruction: draft.instruction,
    query: draft.query,
    commissioned: false,
  });
  await saveBirthKit(buildBirthKit(agent, draft.labels));
  const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const labelsPath = `calibration-${slug}.json`;
  await writeFile(labelsPath, JSON.stringify(draft.labels, null, 2) + '\n', 'utf8');

  stdout.write(`${butter('✓')} ${bold(agent.name)}  ${dim(agent.id)}  ${dim(`· drafted by ${draft.draftedBy}`)}  ${butter('● draft')}\n`);
  stdout.write(`  ${dim('does')}        ${gray(agent.instruction.replace(/\s+/g, ' ').slice(0, 76))}\n`);
  stdout.write(`  ${dim('grounds on')}  ${gray(agent.query)}\n`);
  stdout.write(`  ${dim('labels')}      ${gray(labelsPath)} ${dim(`(${draft.labels.length} starter queries — edit to match your data)`)}\n`);
  stdout.write(`${dim(line)}\n${bold('Your surface:')}\n`);
  stdout.write(`  1. add data      ${dim('npm run demo → paste at :4000, or POST /api/ingest')}\n`);
  stdout.write(`  2. calibrate     ${dim(`comb calibrate --labels ${labelsPath}`)}\n`);
  stdout.write(`  3. commission   ${dim(`comb commission "${agent.name}"   (must pass its birth evals to run)`)}\n`);
  stdout.write(`  4. talk          ${dim(`comb chat --saved "${agent.name}"   (/model, /forget, /budget inside)`)}\n`);
  stdout.write(`  4. watch         ${dim('comb runs · comb trace <id> · comb runs --failed')}\n`);
  stdout.write(`  5. harden        ${dim('comb promote <run id> → comb eval --suite comb-regressions.json')}\n`);
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
  stdout.write(`${dim('window')}  ${windowInfo.tokens} tok ${dim(`(${windowInfo.source})`)}  ${dim('· memory ≤')} ${windowInfo.memoryTokens} tok  ${dim('· budget')} ${cap > 0 ? cap + ' tok/scope' : 'unlimited'}\n`);
  stdout.write(`${dim(line)}\n${dim('Type a task ·')} ${bold('/help')} ${dim('for commands ·')} ${bold('exit')} ${dim('to leave.')}\n`);
}

async function main(): Promise<void> {
  const [mode, ...argv] = process.argv.slice(2);
  const { agent: kind, scopes, saved, fresh, act, rest } = parseFlags(argv);
  const spin = new Spinner();

  // Registry-only commands: no brain/fabric assembly needed.
  if (mode === 'ingest') return ingestFile(argv, scopes);
  if (mode === 'demo-data') return loadDemoData(scopes);
  if (mode === 'reset') return resetBrain(argv);
  if (mode === 'new') return newAgent(rest.join(' '));
  if (mode === 'create') return createAgent(argv);
  if (mode === 'agents') return listAgents();
  if (mode === 'forget') return forgetAgent(rest[0]);
  if (mode === 'commission') return commissionAgent(rest.join(' '));
  if (mode === 'intent') return declareIntent(rest, argv, scopes);
  if (mode === 'intents') return listIntents(scopes);
  if (mode === 'divergences') return showDivergences();
  if (mode === 'skill') return recordSkill(rest, argv, scopes);
  if (mode === 'skills') return listSkills(rest, scopes);
  if (mode === 'budget') return showBudget(scopes);
  if (mode === 'runs') {
    const li = argv.indexOf('--limit');
    return listRuns(li !== -1 ? Math.max(1, Number(argv[li + 1]) || 20) : 20, argv.includes('--failed'));
  }
  if (mode === 'trace') return showTrace(rest[0]);
  if (mode === 'calibrate') return calibrate(argv, scopes);
  if (mode === 'actions') return listActions(argv.includes('--all'));
  if (mode === 'approve') return approveAction(rest[0]);
  if (mode === 'reject') return rejectAction(rest[0], rest.slice(1).join(' '));
  if (mode === 'promote') {
    const si = argv.indexOf('--suite');
    const runId = argv.find((a) => a.startsWith('run_')) ?? rest[0];
    return promoteRun(runId, si !== -1 ? (argv[si + 1] ?? DEFAULT_REGRESSION_SUITE) : DEFAULT_REGRESSION_SUITE, argv.includes('--expect-refusal'));
  }

  // run/chat GENERATE an answer — refuse to fake it without a real model. The
  // deterministic generator is for demo/tests only and must never reach a real
  // user as if it were a real answer. Use MCP (your agent answers) or set a model.
  if ((mode === 'run' || mode === 'chat') && !config.generationEnabled) {
    stdout.write(`${coral('✗')} ${NO_MODEL_MESSAGE}\n`);
    process.exit(1);
  }

  // Resolve the active model's real context window before any agent is built —
  // memory packing and the banner both derive from it.
  windowInfo = await resolveContextWindow();

  const brain = await Brain.create();
  const fabric = await createFabric(brain);
  const agent = await chooseAgent(kind, saved, fresh);
  const ctx = makeCtx(brain, fabric, scopes, spin);

  if (mode === 'chat') {
    // The chat session is also where agents are operated: /agent switches who
    // you're talking to, /model hot-swaps the local generation model, /forget
    // wipes memory — all without leaving the conversation.
    let current: Agent = agent;
    let currentDef: CustomAgent | null = saved ? ((await resolveAgent(getCustomAgentStore(), saved)) ?? null) : null;
    banner(current, fabric, scopes);
    const rl = createInterface({ input: stdin, output: stdout });
    const prompt = (): boolean => stdout.write(`\n${coral('›')} `);
    try {
      // Async-iterate rather than rl.question(): the iterator BUFFERS lines
      // that arrive while a turn is being processed (a piped/scripted session
      // delivers everything at once) and ends cleanly on stdin EOF — question()
      // drops those lines and rejects with "readline was closed".
      prompt();
      for await (const raw of rl) {
        const line = raw.trim();
        if (!line) {
          prompt();
          continue;
        }
        if (line === 'exit' || line === 'quit') break;
        const command = parseChatCommand(line);
        if (!command) {
          await runOnce(current, ctx, line, spin);
          prompt();
          continue;
        }
        if (command.cmd === 'exit') break;
        switch (command.cmd) {
          case 'help':
            stdout.write(CHAT_HELP);
            break;
          case 'agents':
            await listAgents();
            break;
          case 'budget':
            await showBudget(scopes);
            break;
          case 'forget':
            if (currentDef) {
              await getConversationStore().clear(currentDef.id);
              stdout.write(`${butter('✓')} memory cleared for ${bold(currentDef.name)}.\n`);
            } else {
              stdout.write(gray('current agent is not a saved agent — nothing to forget.\n'));
            }
            break;
          case 'agent': {
            const next = await switchChatAgent(command.arg);
            if (!next) {
              stdout.write(`${coral('✗')} no agent matches ${bold(command.arg || '<name>')} — ${bold('/agents')} to list.\n`);
            } else {
              current = next.agent;
              currentDef = next.def;
              stdout.write(`${butter('✓')} talking to ${bold(current.name)}\n`);
            }
            break;
          }
          case 'model': {
            if (!command.arg) {
              stdout.write(gray('usage: /model <ollama model, e.g. qwen2.5:14b>\n'));
              break;
            }
            if (!brain.setGenerationModel(command.arg)) {
              stdout.write(`${coral('✗')} /model needs the local backend (LLM_BACKEND=local).\n`);
              break;
            }
            // The tool-loop agent holds its own model handle — rebuild it too.
            if (current.name === 'tools') current = new ToolLoopAgent(config.ollama.baseUrl, command.arg);
            stdout.write(`${butter('✓')} generation model → ${bold(command.arg)}  ${dim('(recall, scopes, memory, grounding unchanged)')}\n`);
            break;
          }
          case 'unknown':
            stdout.write(gray(`unknown command /${command.raw} — try /help\n`));
            break;
        }
        prompt();
      }
    } finally {
      rl.close();
      await fabric.close();
    }
    stdout.write(dim('\nbye.\n'));
    return;
  }

  // ACT shape: the agent DOES a task — it drafts a grounded action into the
  // approval queue (propose → approve → deliver) instead of just answering.
  if (mode === 'run' && act) {
    const task = rest.join(' ').trim();
    if (!task) { stdout.write(gray('usage: comb run --saved <name> --act "<task to do>"\n')); await fabric.close(); process.exit(1); }
    const def = saved ? await resolveAgent(getCustomAgentStore(), saved) : null;
    const instruction = def?.instruction ?? 'Draft the requested action from the brain, grounded and cited.';
    const r = await ActionSvc.create(brain).propose({ title: task.slice(0, 60), instruction, query: task, by: def ? `saved:${def.name}` : 'cli' }, scopes);
    spin.stop();
    if (!r.ok) stdout.write(`${coral('✗')} ${r.reason}\n`);
    else stdout.write(`${butter('✓')} drafted action ${bold(r.action.id.slice(0, 8))} (${r.action.status}) — review: ${bold('comb actions')}\n\n${dim(r.action.body.slice(0, 400))}\n`);
    await fabric.close();
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
