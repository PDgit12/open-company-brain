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

const ENV = '.env';
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

function reportMode(map) {
  const lb = Boolean(map.LANGBASE_API_KEY && map.LANGBASE_API_KEY.trim());
  const db = Boolean(map.DATABASE_URL && map.DATABASE_URL.trim());
  console.log('\n  Configuration');
  console.log(`   ${lb ? '✓' : '○'} Langbase API key   ${lb ? 'set — live recall + generation' : 'blank → mock mode'}`);
  console.log(`   ${db ? '✓' : '○'} DATABASE_URL       ${db ? 'set — your Postgres' : 'blank → in-memory seed data'}`);
  if (lb) {
    console.log('   ! Langbase Memory also needs an embedding-provider key (e.g. OpenAI)');
    console.log('     configured in your Langbase account — separate from any LLM/OpenRouter key.');
  }
  console.log(`\n  Mode: recall=${lb ? 'live' : 'mock'}  generation=${lb ? 'live' : 'mock'}  data=${db ? 'postgres' : 'seed'}`);
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
  console.log('   npm run sync     build the recall layer from your data');
  console.log('   npm run demo     open the brain at http://localhost:4000\n');
}

async function doctor() {
  if (!(await exists(ENV))) {
    console.log('No .env yet — run:  npm run init');
    return;
  }
  reportMode(parseEnv(await readFile(ENV, 'utf8')));
  console.log('');
}

const cmd = process.argv[2] ?? 'init';
(cmd === 'doctor' ? doctor : init)().catch((e) => {
  console.error(e);
  process.exit(1);
});
