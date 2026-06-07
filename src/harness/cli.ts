/**
 * Harness operator shell:
 *
 *   company-brain run "<task>" [--agent auto|builtin|tools] [--scopes a,b]
 *   company-brain chat        [--agent …] [--scopes …]      interactive REPL
 *
 * `run` is one-shot; `chat` keeps one brain + fabric warm across turns. Both run
 * the chosen agent on the governed kernel + connected tools, printing the answer
 * and the tool steps it took.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Brain } from '../brain/brain.js';
import { config, describeMode } from '../config.js';
import { createFabric } from '../tools/assemble.js';
import { pickAgent, type AgentKind } from './run.js';
import type { AgentResult } from './agent.js';

interface Flags { agent: AgentKind; scopes: string[]; rest: string[]; }

function parseFlags(argv: string[]): Flags {
  let agent: AgentKind = 'auto';
  let scopes = [config.demoUserAccessScope];
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent') agent = (argv[++i] as AgentKind) ?? 'auto';
    else if (argv[i] === '--scopes') scopes = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else rest.push(argv[i]!);
  }
  return { agent, scopes, rest };
}

function printResult(r: AgentResult): void {
  if (r.steps.length) {
    process.stdout.write(`\n  steps (${r.steps.length}):\n`);
    for (const s of r.steps) process.stdout.write(`   → ${s.tool}(${JSON.stringify(s.args)})\n`);
  }
  process.stdout.write(`\n${r.output}\n\n`);
}

async function main(): Promise<void> {
  const [mode, ...argv] = process.argv.slice(2);
  const { agent: kind, scopes, rest } = parseFlags(argv);

  if (mode === 'chat') {
    const brain = await Brain.create();
    const fabric = await createFabric(brain);
    const agent = pickAgent(kind);
    process.stdout.write(`\nopen-brain · ${agent.name} agent · ${describeMode()} · scopes=[${scopes.join(',')}]\n`);
    process.stdout.write(`${fabric.list().length} tools available. Type a task, or "exit".\n`);
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      for (;;) {
        const line = (await rl.question('\n› ')).trim();
        if (!line || line === 'exit' || line === 'quit') break;
        const r = await agent.run(line, { brain, fabric, scopes });
        printResult(r);
      }
    } finally {
      await rl.close();
      await fabric.close();
    }
    return;
  }

  // one-shot: company-brain run "<task>"
  const task = rest.join(' ').trim();
  if (!task) {
    process.stderr.write('usage: company-brain run "<task>" [--agent auto|builtin|tools] [--scopes a,b]\n');
    process.exit(1);
  }
  const brain = await Brain.create();
  const fabric = await createFabric(brain);
  const agent = pickAgent(kind);
  try {
    printResult(await agent.run(task, { brain, fabric, scopes }));
  } finally {
    await fabric.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
