/**
 * Run an agent on the OS — the entry the CLI and library share.
 *
 * Assembles the governed context (kernel + Tool Fabric + scopes), picks an agent
 * adapter, runs it, and tears down connections. `auto` uses the tool-loop agent
 * on the local (tool-capable) backend and the built-in agent elsewhere.
 */

import { Brain } from '../brain/brain.js';
import { config } from '../config.js';
import { createFabric } from '../tools/assemble.js';
import { tracedRun } from '../observability/runs.js';
import { BuiltinAgent, ToolLoopAgent, type Agent, type AgentResult } from './agent.js';

export type AgentKind = 'auto' | 'builtin' | 'tools';

export function pickAgent(kind: AgentKind = 'auto'): Agent {
  const toolLoop = () => new ToolLoopAgent(config.ollama.baseUrl, config.ollama.generationModel);
  if (kind === 'builtin') return new BuiltinAgent();
  if (kind === 'tools') return toolLoop();
  // auto: the tool loop needs a tool-capable model — use it on the local backend.
  return config.backend === 'local' ? toolLoop() : new BuiltinAgent();
}

export async function runAgent(
  task: string,
  opts: { agent?: AgentKind; scopes?: string[] } = {},
): Promise<AgentResult> {
  const brain = await Brain.create();
  const fabric = await createFabric(brain);
  const agent = pickAgent(opts.agent);
  const scopes = opts.scopes ?? [config.demoUserAccessScope];
  try {
    // tracedRun persists a trace (best-effort) so library callers get the same
    // observability as the CLI.
    return await tracedRun(agent, task, { brain, fabric, scopes });
  } finally {
    await fabric.close();
  }
}
