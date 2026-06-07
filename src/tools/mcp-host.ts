/**
 * MCP host — connect to EXTERNAL MCP servers and expose their tools to the fabric.
 *
 * This is the other half of MCP: Open Brain is an MCP *server* (door 3, so other
 * agents use the brain) AND an MCP *host* (here, so the brain's own agents can use
 * anyone else's tools — your knit MCP, a filesystem server, GitHub, …). Each
 * connected server becomes a namespace; its tools are wrapped as fabric ToolSpecs.
 *
 * Connections are stdio child processes, exactly how you already run knit/gbrain.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolSource, ToolSpec } from './fabric.js';

/** One external MCP server to connect to (matches the .mcp.json shape). */
export interface McpServerConfig {
  /** Namespace + display name, e.g. "knit". */
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpTextContent {
  type: string;
  text?: string;
}

/** Flatten an MCP tool result's content blocks into a single string. */
function flatten(result: unknown): string {
  const content = (result as { content?: McpTextContent[] })?.content ?? [];
  const text = content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('\n');
  return text || JSON.stringify(result);
}

/** One connected external MCP server, presented as a fabric ToolSource. */
export class McpServerSource implements ToolSource {
  readonly namespace: string;
  private client: Client | null = null;

  constructor(private readonly cfg: McpServerConfig) {
    this.namespace = cfg.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  }

  private async ensure(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StdioClientTransport({
      command: this.cfg.command,
      args: this.cfg.args ?? [],
      // Inherit the parent env so the child server gets PATH etc., plus overrides.
      env: { ...(process.env as Record<string, string>), ...(this.cfg.env ?? {}) },
    });
    const client = new Client({ name: 'open-brain-host', version: '0.4.0' });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  async list(): Promise<ToolSpec[]> {
    const client = await this.ensure();
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      id: `${this.namespace}.${t.name}`,
      namespace: this.namespace,
      name: t.name,
      description: t.description ?? `${t.name} (from ${this.namespace})`,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object' },
      // External tools are governed by the host's own auth; we pass args through.
      // Access scoping for OUR kernel data still applies to brain.* tools.
      call: async (args) => {
        const res = await client.callTool({ name: t.name, arguments: args });
        return flatten(res);
      },
    }));
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }
}

/** Build one ToolSource per configured external MCP server. */
export function mcpSources(servers: McpServerConfig[]): McpServerSource[] {
  return servers.map((s) => new McpServerSource(s));
}
