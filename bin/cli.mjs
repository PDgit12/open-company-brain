#!/usr/bin/env node
/**
 * Company Brain CLI — the "just add your keys" setup experience.
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
  const explicit = (map.LLM_BACKEND || 'auto').trim();
  if (explicit && explicit !== 'auto') return explicit; // mock | langbase | local
  return lb ? 'langbase' : 'mock';
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
  console.log('\n  Company Brain — setup\n  ─────────────────────');
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
  console.log('   # connect an AI agent (Claude/Cursor): company-brain mcp\n');
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

const cmd = process.argv[2] ?? 'init';
const route = cmd === 'doctor' ? doctor : cmd === 'mcp' ? mcp : init;
route().catch((e) => {
  console.error(e);
  process.exit(1);
});
