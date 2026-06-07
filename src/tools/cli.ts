/**
 * Harness tool commands (operator shell):
 *
 *   company-brain tools                 list every tool an agent can use
 *                                       (kernel built-ins + connected MCP servers)
 *   company-brain connect <name> -- <command> [args…]
 *                                       register an external MCP server (e.g. knit)
 *
 * These make Open Brain an MCP *host*: bring any MCP, its tools join the fabric.
 */

import { Brain } from '../brain/brain.js';
import { createFabric } from './assemble.js';
import { addMcpServer, configPath } from './config.js';
import type { McpServerConfig } from './mcp-host.js';

async function listTools(): Promise<void> {
  const brain = await Brain.create();
  const fabric = await createFabric(brain);
  const tools = fabric.list();
  const byNs = new Map<string, typeof tools>();
  for (const t of tools) byNs.set(t.namespace, [...(byNs.get(t.namespace) ?? []), t]);
  process.stdout.write(`\n${tools.length} tool(s) across ${byNs.size} source(s):\n`);
  for (const [ns, list] of byNs) {
    process.stdout.write(`\n  ${ns}\n`);
    for (const t of list) process.stdout.write(`    • ${t.id}  —  ${t.description.slice(0, 80)}\n`);
  }
  process.stdout.write('\n');
  await fabric.close();
}

/** Parse `connect <name> -- <command> [args…]`. */
function parseConnect(argv: string[]): McpServerConfig {
  const sep = argv.indexOf('--');
  const name = argv[0];
  if (!name || name === '--') throw new Error('usage: company-brain connect <name> -- <command> [args…]');
  if (sep === -1 || !argv[sep + 1]) throw new Error('missing command: company-brain connect <name> -- <command> [args…]');
  const [command, ...args] = argv.slice(sep + 1);
  return { name, command: command!, ...(args.length ? { args } : {}) };
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'connect') {
    const server = parseConnect(rest);
    const path = await addMcpServer(server);
    process.stdout.write(`✓ Connected MCP server "${server.name}" → ${path}\n  Run \`company-brain tools\` to see its tools.\n`);
  } else {
    await listTools();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n  (config: ${configPath()})\n`);
  process.exit(1);
});
