#!/usr/bin/env node
/**
 * Comb CLI — the "just add your keys" setup experience.
 *
 *   npm run init      guided setup: creates .env and (interactively) takes your keys
 *   npm run doctor    report the current mode and what's still needed
 *
 * Philosophy: the framework is the product. A user supplies API keys (and points
 * it at their data) — nothing else. With no keys it runs in mock mode immediately.
 *
 * Zero dependencies, TTY-safe (never hangs in a non-interactive shell).
 */

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
  console.log('   npm run demo         open the brain at http://localhost:4000');
  console.log('   # fully local ($0/query): set LLM_BACKEND=local in .env, then:');
  console.log('   npm run setup:local  pull models + seed pgvector, then `npm run demo`');
  console.log('   # connect an AI agent (Claude/Cursor): comb mcp\n');
}

async function doctor() {
  if (!(await exists(ENV))) {
    console.log('No .env yet — run:  npm run init');
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

function help() {
  console.log(`
  comb — your company's agentic OS harness (Claude Code, for your own agents)

  Usage: comb <command> [options]

  Build & run agents (the harness)
    new "<wish>"         ONE PROMPT builds the whole agent: definition +
                         calibration labels + every next step, ready to run
    create               build a saved agent manually
                         wizard (a TTY) or flags for CI:
                         --name N --instruction I [--query Q]
    agents               list your saved agents
    forget <name>        wipe a saved agent's conversation memory
    run "<task>"         run an agent over your governed brain + connected tools
                         [--agent auto|builtin|tools] [--saved <name>] [--fresh] [--scopes a,b]
    chat                 interactive agent REPL   [--saved <name>]
    budget               show token usage against the per-scope cap  [--scopes a,b]
    actions              the human-in-the-loop queue — what awaits your approval
                         [--all includes decided history]
    approve <id>         approve a proposed action (executes + delivers)
    reject <id> [why]    decline it (the draft becomes negative feedback)
    runs                 recent agent runs with token + latency metrics
                         [--limit N] [--failed]  (--failed = refused/ungrounded)
    trace <id>           full tool-call trace + metrics for one run
    promote <run id>     turn a run into a regression eval case (prod → eval)
                         [--suite file.json] [--expect-refusal]
    eval                 run the agentic eval suite (grounding, refusal, tools,
                         budget, scope, recall)   [--suite file.json]
    calibrate            place the grounding floor from labeled queries
                         --labels labels.json [--scopes a,b]
    tools                list every tool an agent can use (brain + connected)
    connect <name> -- <cmd> [args…]
                         connect a tool/MCP (e.g. your knit MCP) or an API

  Setup & data
    init                 guided setup — create .env and add your keys
    doctor               report the active backend and what's still needed
    ingest <file>        feed the brain from the CLI (.txt/.md/.csv/.json)
                         [--source name] [--scope s]
    demo                 (npm run demo) web console + HTTP API at :4000

  Advanced
    mcp                  also expose this brain to other agents over MCP (optional)
    help                 show this
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
  if (cmd === 'create') return harnessCmd(['create', ...process.argv.slice(3)]);
  if (cmd === 'agents') return harnessCmd(['agents', ...process.argv.slice(3)]);
  if (cmd === 'forget') return harnessCmd(['forget', ...process.argv.slice(3)]);
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
