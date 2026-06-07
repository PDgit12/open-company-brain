/**
 * Assemble a ready-to-use Tool Fabric: the kernel's built-in tools plus every
 * connected external MCP server. This is the one call the harness (and the CLI)
 * use to get "all the tools an agent can use, governed and namespaced".
 */

import type { Brain } from '../brain/brain.js';
import { ToolFabric, BuiltinToolSource } from './fabric.js';
import { mcpSources, type McpServerConfig } from './mcp-host.js';
import { loadMcpServers } from './config.js';

export async function createFabric(
  brain: Brain,
  opts: { servers?: McpServerConfig[] } = {},
): Promise<ToolFabric> {
  const servers = opts.servers ?? (await loadMcpServers());
  const fabric = new ToolFabric([new BuiltinToolSource(brain), ...mcpSources(servers)]);
  await fabric.refresh();
  return fabric;
}
