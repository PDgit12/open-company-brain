/**
 * Where the harness reads its connected MCP servers from.
 *
 * Uses the SAME `{ "mcpServers": { name: { command, args, env } } }` shape as
 * Claude / Cursor configs, so you can paste an existing block (including your
 * knit MCP) straight in. Looked up from OPENBRAIN_MCP_CONFIG, else
 * `openbrain.mcp.json` in the working directory. Missing file = no external tools
 * (the brain's built-in tools always work).
 */

import { readFile, writeFile } from 'node:fs/promises';
import type { McpServerConfig } from './mcp-host.js';

const DEFAULT_PATH = 'openbrain.mcp.json';

export function configPath(): string {
  return process.env.OPENBRAIN_MCP_CONFIG?.trim() || DEFAULT_PATH;
}

interface ConfigFile {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

/** Read connected MCP servers from the config file (empty if none/missing). */
export async function loadMcpServers(path = configPath()): Promise<McpServerConfig[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as ConfigFile;
  return Object.entries(parsed.mcpServers ?? {}).map(([name, s]) => ({
    name,
    command: s.command,
    ...(s.args ? { args: s.args } : {}),
    ...(s.env ? { env: s.env } : {}),
  }));
}

/** Add (or replace) one server in the config file; returns the written path. */
export async function addMcpServer(server: McpServerConfig, path = configPath()): Promise<string> {
  let parsed: ConfigFile = {};
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as ConfigFile;
  } catch {
    /* new file */
  }
  parsed.mcpServers = parsed.mcpServers ?? {};
  parsed.mcpServers[server.name] = {
    command: server.command,
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
  await writeFile(path, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return path;
}
