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

function parseFlags(argv: string[]): { agent: AgentKind; scopes: string[]; rest: string[] } {
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

function banner(agent: Agent, fabric: ToolFabric, scopes: string[]): void {
  const line = '─'.repeat(54);
  stdout.write(`\n${butter('◆')} ${bold('Comb')} ${dim('· your agentic OS harness')}\n${dim(line)}\n`);
  stdout.write(`${dim('agent')}   ${agent.name}\n`);
  stdout.write(`${dim('mode')}    ${describeMode()}\n`);
  stdout.write(`${dim('scopes')}  ${scopes.join(', ')}\n`);
  stdout.write(`${dim('tools')}   ${fabric.list().length} available  ${dim('(' + fabric.list().map((t) => t.id).slice(0, 6).join(', ') + '…)')}\n`);
  stdout.write(`${dim(line)}\n${dim('Type a task, or')} ${bold('exit')}${dim('.')}\n`);
}

async function main(): Promise<void> {
  const [mode, ...argv] = process.argv.slice(2);
  const { agent: kind, scopes, rest } = parseFlags(argv);
  const spin = new Spinner();

  const brain = await Brain.create();
  const fabric = await createFabric(brain);
  const agent = pickAgent(kind);
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
