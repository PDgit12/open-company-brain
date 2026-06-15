/**
 * `comb install <client>` — the pure logic, extracted from bin/cli.mjs so it is
 * unit-tested instead of only smoke-tested. The CLI shell does the file I/O; this
 * module decides WHERE the config goes and WHAT block to write. Keeping it here
 * (typed, covered) is the difference between "an install command" and "an install
 * command that can break silently on a client we forgot to test".
 */

import os from 'node:os';
import path from 'node:path';

export type ConfigShape = 'mcpServers' | 'vscode';

export interface ClientTarget {
  /** Absolute path to the client's MCP config file. */
  file: string;
  /** Which JSON shape this client expects. */
  shape: ConfigShape;
  /** One-line "do this next" for the user. */
  restart: string;
}

/** The shared brain dir both the CLI and the connected tool point at. */
export function sharedBrainDir(home: string = os.homedir()): string {
  return path.join(home, '.comb-brain');
}

/**
 * The clean, model-free, NO-SEED env for an MCP connection: Comb runs no model
 * (the host is the intelligence), retrieval is keyword ($0/query), the brain holds
 * ONLY the user's data, and the data dir is absolute so the tool and CLI share it.
 */
export function mcpServerEnv(dataDir: string, scopes = 'default-team'): Record<string, string> {
  return {
    LLM_BACKEND: 'modelfree',
    COMB_SEED_DEMO: 'off',
    COMB_RETRIEVAL: 'keyword',
    COMB_DATA_DIR: dataDir,
    MCP_PRINCIPAL: 'you',
    MCP_SCOPES: scopes,
  };
}

export const SUPPORTED_CLIENTS = ['claude', 'claude-desktop', 'claude-code', 'cursor', 'vscode', 'windsurf'] as const;

/** Resolve a client name to its config file, shape, and restart hint. */
export function clientTarget(
  client: string,
  opts: { home?: string; cwd?: string; platform?: NodeJS.Platform } = {},
): ClientTarget | null {
  const home = opts.home ?? os.homedir();
  const cwd = opts.cwd ?? process.cwd();
  const darwin = (opts.platform ?? process.platform) === 'darwin';
  const appSupport = darwin ? path.join(home, 'Library/Application Support') : path.join(home, '.config');
  switch (client) {
    case 'claude':
    case 'claude-desktop':
      return { file: path.join(appSupport, 'Claude/claude_desktop_config.json'), shape: 'mcpServers', restart: 'Restart Claude Desktop.' };
    case 'claude-code':
      return { file: path.join(cwd, '.mcp.json'), shape: 'mcpServers', restart: 'Reopen this project in Claude Code (check `claude mcp list`).' };
    case 'cursor':
      return { file: path.join(home, '.cursor/mcp.json'), shape: 'mcpServers', restart: 'Restart Cursor.' };
    case 'windsurf':
      return { file: path.join(home, '.codeium/windsurf/mcp_config.json'), shape: 'mcpServers', restart: 'Restart Windsurf.' };
    case 'vscode':
      return { file: path.join(cwd, '.vscode/mcp.json'), shape: 'vscode', restart: 'Reload VS Code; start the server in Copilot agent mode.' };
    default:
      return null;
  }
}

/**
 * Merge the "comb" server block into an existing client config WITHOUT clobbering
 * the user's other servers. VS Code uses `servers` + a `type`; everyone else uses
 * `mcpServers`. Returns a new object (no mutation of the input).
 */
export function mergeServerConfig(
  existing: Record<string, unknown>,
  shape: ConfigShape,
  env: Record<string, string>,
): Record<string, unknown> {
  const json: Record<string, unknown> = { ...existing };
  if (shape === 'vscode') {
    const servers = { ...((json.servers as Record<string, unknown>) ?? {}) };
    servers.comb = { type: 'stdio', command: 'comb', args: ['mcp'], env };
    json.servers = servers;
  } else {
    const mcpServers = { ...((json.mcpServers as Record<string, unknown>) ?? {}) };
    mcpServers.comb = { command: 'comb', args: ['mcp'], env };
    json.mcpServers = mcpServers;
  }
  return json;
}
