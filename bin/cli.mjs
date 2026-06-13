#!/usr/bin/env node
/**
 * Comb CLI — the operator command for the governed company brain + OS.
 *
 *   comb init      guided setup: pick a backend (local Ollama / your key)
 *   comb doctor    report the active backend and what's still needed
 *
 * Suppress Node's transitive-dependency deprecation noise (e.g. punycode) so
 * the CLI output is clean; inherited by spawned subcommands via the env.
 */
process.env.NODE_NO_WARNINGS = '1';

import { readFile, writeFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENV = '.env';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = '.env.example';

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

function parseEnv(text) {
  const map = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function setEnvLine(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  return `${text.trimEnd()}\n${key}=${value}\n`;
}

async function ensureEnv() {
  if (!(await exists(ENV))) {
    await writeFile(ENV, await readFile(EXAMPLE, 'utf8'));
    console.log('• created .env from .env.example');
  }
}

// Mirror src/config.ts backend resolution so the CLI never lies about the mode.
function resolveBackend(map) {
  const lb = Boolean(map.LANGBASE_API_KEY && map.LANGBASE_API_KEY.trim());
  const oa = Boolean(map.OPENAI_API_KEY && map.OPENAI_API_KEY.trim());
  const explicit = (map.LLM_BACKEND || 'auto').trim();
  if (explicit && explicit !== 'auto') return explicit; // mock | langbase | local | openai
  return oa ? 'openai' : lb ? 'langbase' : 'mock';
}

function reportMode(map) {
  const backend = resolveBackend(map);
  const lb = Boolean(map.LANGBASE_API_KEY && map.LANGBASE_API_KEY.trim());
  const db = Boolean(map.DATABASE_URL && map.DATABASE_URL.trim());
  const vec = Boolean((map.VECTOR_DATABASE_URL && map.VECTOR_DATABASE_URL.trim()) || db);
  console.log('\n  Configuration');
  console.log(`   • backend          ${backend}  (LLM_BACKEND=${map.LLM_BACKEND || 'auto'})`);

  if (backend === 'local') {
    console.log(`   ✓ Ollama           ${map.OLLAMA_BASE_URL || 'http://localhost:11434'}  (gen=${map.OLLAMA_GENERATION_MODEL || 'llama3.2:1b'}, embed=${map.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text'})`);
    console.log(`   ${vec ? '✓' : '✗'} pgvector Postgres  ${vec ? 'set' : 'MISSING — set VECTOR_DATABASE_URL (or DATABASE_URL)'}`);
    console.log('   ! needs `ollama serve` running and the models pulled — `npm run setup:local` does both.');
    console.log('\n  Mode: recall=local  generation=local  ($0 per query)');
    return;
  }

  if (backend === 'openai') {
    const oa = Boolean(map.OPENAI_API_KEY && map.OPENAI_API_KEY.trim());
    console.log(`   ${oa ? '✓' : '✗'} OpenAI-compat key  ${oa ? `set — ${map.OPENAI_BASE_URL || 'https://api.openai.com/v1'} (${map.OPENAI_MODEL || 'gpt-4o-mini'})` : 'MISSING — set OPENAI_API_KEY'}`);
    console.log(`   ${vec ? '✓' : '✗'} pgvector Postgres  ${vec ? 'set' : 'MISSING — set VECTOR_DATABASE_URL (or DATABASE_URL)'}`);
    console.log('\n  Mode: recall=live (your key)  generation=live (your key)');
    return;
  }

  console.log(`   ${lb ? '✓' : '○'} Langbase API key   ${lb ? 'set — managed recall + generation' : 'blank → mock mode'}`);
  console.log(`   ${db ? '✓' : '○'} DATABASE_URL       ${db ? 'set — your Postgres' : 'blank → in-memory seed data'}`);
  if (backend === 'langbase') {
    console.log('   ! Langbase Memory also needs an embedding-provider key (e.g. OpenAI/Google)');
    console.log('     configured in your Langbase account — separate from any LLM key.');
  }
  const mode = backend === 'langbase' ? 'live' : 'mock';
  console.log(`\n  Mode: recall=${mode}  generation=${mode}  data=${db ? 'postgres' : 'seed'}`);
}

async function init() {
  console.log('\n  Comb — setup\n  ─────────────────────');
  await ensureEnv();
  let text = await readFile(ENV, 'utf8');

  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    console.log('\n  Press Enter to skip any key (it will run in mock mode).\n');
    const key = (await rl.question('  Langbase API key: ')).trim();
    if (key) text = setEnvLine(text, 'LANGBASE_API_KEY', key);
    const db = (await rl.question('  Postgres DATABASE_URL (optional): ')).trim();
    if (db) text = setEnvLine(text, 'DATABASE_URL', db);
    await rl.close();
    await writeFile(ENV, text);
  } else {
    console.log('  • non-interactive shell: .env left as-is — edit it to add your keys.');
  }

  reportMode(parseEnv(text));
  console.log('\n  Next:');
  console.log('   comb doctor          confirm the active backend');
  console.log('   comb ingest <file>   feed the brain your data');
  console.log('   comb run --agent builtin "<question>"   ask it');
  console.log('   # fully local ($0/query) needs Ollama + Postgres+pgvector — see the README.\n');
}

async function doctor() {
  if (!(await exists(ENV))) {
    console.log('No backend configured yet — run:  comb init');
    return;
  }
  reportMode(parseEnv(await readFile(ENV, 'utf8')));
  console.log('');
}

/**
 * Start the stdio MCP server so any agentic environment (Claude, Cursor, …) can
 * use the brain as a tool. Runs the compiled server when present (published /
 * built), else falls back to tsx for source checkouts. stdio is passed straight
 * through so the MCP host speaks to the server directly.
 */
async function mcp() {
  const dist = path.join(ROOT, 'dist', 'mcp', 'server.js');
  const useDist = await exists(dist);
  const [cmd, args] = useDist
    ? ['node', [dist]]
    : ['npx', ['-y', 'tsx', path.join(ROOT, 'src', 'mcp', 'server.ts')]];
  const child = spawn(cmd, args, { stdio: 'inherit', cwd: process.cwd() });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/**
 * Harness tool commands: `tools` (list the fabric) and `connect` (register an
 * external MCP server). Routes to the compiled entry when built, else tsx.
 * Forwards the subcommand + its args so the entry can parse them.
 */
async function toolsCmd(forwarded) {
  const dist = path.join(ROOT, 'dist', 'tools', 'cli.js');
  const useDist = await exists(dist);
  const [cmd, base] = useDist ? ['node', [dist]] : ['npx', ['-y', 'tsx', path.join(ROOT, 'src', 'tools', 'cli.ts')]];
  const child = spawn(cmd, [...base, ...forwarded], { stdio: 'inherit', cwd: process.cwd() });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** Harness operator shell: `run "<task>"` and `chat` (forwarded to src/harness/cli.ts). */
async function harnessCmd(forwarded) {
  const dist = path.join(ROOT, 'dist', 'harness', 'cli.js');
  const useDist = await exists(dist);
  const [cmd, base] = useDist ? ['node', [dist]] : ['npx', ['-y', 'tsx', path.join(ROOT, 'src', 'harness', 'cli.ts')]];
  const child = spawn(cmd, [...base, ...forwarded], { stdio: 'inherit', cwd: process.cwd() });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/** Agentic eval runner: `eval [--suite file.json]` (forwarded to src/eval/agent-run.ts). */
async function evalCmd(forwarded) {
  const dist = path.join(ROOT, 'dist', 'eval', 'agent-run.js');
  const useDist = await exists(dist);
  const [cmd, base] = useDist ? ['node', [dist]] : ['npx', ['-y', 'tsx', path.join(ROOT, 'src', 'eval', 'agent-run.ts')]];
  const child = spawn(cmd, [...base, ...forwarded], { stdio: 'inherit', cwd: process.cwd() });
  child.on('exit', (code) => process.exit(code ?? 0));
}

// ── palette (TTY-only; degrades to plain text when piped) ────────────────────
const tty = process.stdout.isTTY;
const wrap = (open) => (s) => (tty ? `\x1b[${open}m${s}\x1b[0m` : s);
const dim = wrap('2');
const bold = wrap('1');
const coral = wrap('38;5;209');
const butter = wrap('38;5;222');

function help() {
  const c = (cmd) => bold(cmd);
  const d = (s) => dim(s);
  const h = (s) => `\n  ${butter('◆')} ${bold(s)}\n  ${dim('─'.repeat(60))}`;
  console.log(`
  ${butter('◆')} ${bold('comb')} ${dim('· your company’s agentic OS harness')}
  ${dim('Claude Code, but for your own agents — governed, cited, evaluated.')}

  ${dim('Usage:')} comb ${coral('<command>')} [options]
${h('Build agents')}
    ${c('new "<wish>"')}         ${d('ONE PROMPT builds the whole agent + calibration labels')}
    ${c('create')}               ${d('manual build — wizard (TTY) or CI flags:')}
                         ${d('--name N --instruction I [--query Q]')}
    ${c('commission <name>')}    ${d('run an agent’s birth evals — must pass to become runnable')}
    ${c('agents')}               ${d('list your saved agents (✓ commissioned · ● draft)')}
    ${c('forget <name>')}        ${d('wipe a saved agent’s conversation memory')}
${h('Run them')}
    ${c('run "<task>"')}         ${d('one governed, cited run')}
                         ${d('[--agent auto|builtin|tools] [--saved <name>] [--fresh] [--scopes a,b]')}
    ${c('chat')}                 ${d('REPL — /agent /model /budget /forget inside')} ${d('[--saved <name>]')}
    ${c('budget')}               ${d('token usage vs the per-scope cap  [--scopes a,b]')}
${h('Approve their actions (human-in-the-loop)')}
    ${c('actions')}              ${d('what awaits YOUR approval  [--all = decided history]')}
    ${c('approve <id>')}         ${d('approve — executes + delivers (idempotent)')}
    ${c('reject <id> [why]')}    ${d('decline — the draft becomes negative feedback')}
${h('The closed loop (intent → compare → adjust)')}
    ${c('skill "<name>"')}        ${d('record HOW work is done  --body "..." [--triggers a,b]')}
    ${c('skills [query]')}         ${d('list or trigger-match the skills (the living map)')}
    ${c('intent "<should>"')}    ${d('declare what SHOULD be happening (goal|spec|policy|procedure)')}
    ${c('intents')}              ${d('list the reference signals reality is compared against')}
    ${c('divergences')}          ${d('the verdicts: ⚑ diverged (flag→approval queue) · aligned · silent')}
${h('Watch · test · harden')}
    ${c('runs')}                 ${d('recent runs: tokens · latency · tools  [--limit N] [--failed]')}
    ${c('trace <id>')}           ${d('full tool-call autopsy for one run')}
    ${c('promote <run id>')}     ${d('turn a run into a permanent regression test')}
                         ${d('[--suite file.json] [--expect-refusal]')}
    ${c('eval')}                 ${d('agentic eval suite: grounds · refuses · tools · scope')}
                         ${d('[--suite file.json]')}
    ${c('calibrate')}            ${d('place the grounding floor from YOUR labeled queries')}
                         ${d('--labels labels.json [--scopes a,b]')}
${h('Data & tools')}
    ${c('ingest <file>')}        ${d('feed the brain from the CLI (.txt/.md/.csv/.json)')}
                         ${d('[--source name] [--scope s]')}
    ${c('tools')}                ${d('every tool an agent can use (brain + connected)')}
    ${c('connect <name> -- <cmd>')} ${d('plug in any MCP server or API')}
${h('Setup')}
    ${c('init')}                 ${d('guided setup — create .env, add your keys')}
    ${c('doctor')}               ${d('which backend is live and what’s missing')}
    ${c('demo')}                 ${d('(npm run demo) web console + HTTP API at :4000')}
    ${c('mcp')}                  ${d('expose this brain to other agents over MCP')}

  ${dim('Start here:')}  comb ingest <your-file.md>  ${dim('→')}  comb new "<what you want>"  ${dim('→')}  comb chat
`);
}

const cmd = process.argv[2] ?? 'help';
const run = () => {
  if (cmd === 'init') return init();
  if (cmd === 'doctor') return doctor();
  if (cmd === 'mcp') return mcp();
  if (cmd === 'tools') return toolsCmd([]);
  if (cmd === 'connect') return toolsCmd(['connect', ...process.argv.slice(3)]);
  if (cmd === 'run') return harnessCmd(['run', ...process.argv.slice(3)]);
  if (cmd === 'chat') return harnessCmd(['chat', ...process.argv.slice(3)]);
  if (cmd === 'new') return harnessCmd(['new', ...process.argv.slice(3)]);
  if (cmd === 'ingest') return harnessCmd(['ingest', ...process.argv.slice(3)]);
  if (cmd === 'demo-data') return harnessCmd(['demo-data', ...process.argv.slice(3)]);
  if (cmd === 'reset') return harnessCmd(['reset', ...process.argv.slice(3)]);
  if (cmd === 'create') return harnessCmd(['create', ...process.argv.slice(3)]);
  if (cmd === 'agents') return harnessCmd(['agents', ...process.argv.slice(3)]);
  if (cmd === 'forget') return harnessCmd(['forget', ...process.argv.slice(3)]);
  if (cmd === 'commission') return harnessCmd(['commission', ...process.argv.slice(3)]);
  if (cmd === 'intent') return harnessCmd(['intent', ...process.argv.slice(3)]);
  if (cmd === 'intents') return harnessCmd(['intents', ...process.argv.slice(3)]);
  if (cmd === 'divergences') return harnessCmd(['divergences', ...process.argv.slice(3)]);
  if (cmd === 'skill') return harnessCmd(['skill', ...process.argv.slice(3)]);
  if (cmd === 'skills') return harnessCmd(['skills', ...process.argv.slice(3)]);
  if (cmd === 'budget') return harnessCmd(['budget', ...process.argv.slice(3)]);
  if (cmd === 'runs') return harnessCmd(['runs', ...process.argv.slice(3)]);
  if (cmd === 'trace') return harnessCmd(['trace', ...process.argv.slice(3)]);
  if (cmd === 'promote') return harnessCmd(['promote', ...process.argv.slice(3)]);
  if (cmd === 'calibrate') return harnessCmd(['calibrate', ...process.argv.slice(3)]);
  if (cmd === 'actions') return harnessCmd(['actions', ...process.argv.slice(3)]);
  if (cmd === 'approve') return harnessCmd(['approve', ...process.argv.slice(3)]);
  if (cmd === 'reject') return harnessCmd(['reject', ...process.argv.slice(3)]);
  if (cmd === 'eval') return evalCmd(process.argv.slice(3));
  help();
  return Promise.resolve();
};
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
