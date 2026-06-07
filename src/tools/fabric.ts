/**
 * The Tool Fabric — the harness's unified, namespaced tool registry.
 *
 * An agent running on the OS shouldn't care WHERE a capability comes from. The
 * fabric merges every tool source into one list with stable, namespaced ids:
 *
 *   brain.search · brain.ingest · brain.list_sources   (the governed kernel)
 *   knit.search_learnings · github.create_issue · …    (any connected MCP server)
 *
 * Namespacing prevents collisions (two servers can both expose `search`). Every
 * call is access-scoped: the caller's scopes are threaded through, so a tool can
 * never return data outside them. This is the "connect any MCP" core — the OS is
 * an MCP *host*, not only an MCP server.
 */

import type { Brain } from '../brain/brain.js';

/** One callable capability, regardless of origin. */
export interface ToolSpec {
  /** Namespaced unique id, e.g. "brain.search" or "knit.search_learnings". */
  id: string;
  namespace: string;
  name: string;
  description: string;
  /** JSON-schema-ish object describing arguments (passed through from MCP). */
  inputSchema: Record<string, unknown>;
  /** Invoke the tool. `scopes` is the caller's access scope set (governance). */
  call(args: Record<string, unknown>, scopes: string[]): Promise<string>;
}

/** A provider of tools (the kernel, or a connected MCP server). */
export interface ToolSource {
  readonly namespace: string;
  list(): Promise<ToolSpec[]>;
  /** Release resources (e.g. close an MCP connection). */
  close(): Promise<void>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Built-in kernel tools — the governed brain exposed as fabric tools, called
 * in-process (no MCP round-trip). This is what makes the brain itself a first-
 * class tool source every agent gets for free.
 */
export class BuiltinToolSource implements ToolSource {
  readonly namespace = 'brain';
  constructor(private readonly brain: Brain) {}

  async list(): Promise<ToolSpec[]> {
    const ns = this.namespace;
    return [
      {
        id: `${ns}.search`,
        namespace: ns,
        name: 'search',
        description: 'Search the governed brain for grounded, access-scoped knowledge. Returns the top records with provenance and similarity score.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        call: async (args, scopes) => {
          const chunks = await this.brain.search(str(args.query), scopes);
          if (!chunks.length) return 'No matching records (within the allowed scopes).';
          return chunks.map((c, i) => `[#${i + 1} source=${c.source} score=${c.score.toFixed(2)}]\n${c.text}`).join('\n\n---\n\n');
        },
      },
      {
        id: `${ns}.ask`,
        namespace: ns,
        name: 'ask',
        description: "Ask the brain a question and get a grounded, cited answer from the brain's own model. Refuses if it has no grounding.",
        inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
        call: async (args, scopes) => {
          const { answer, sources } = await this.brain.ask(str(args.question), scopes);
          const cites = [...new Set(sources.map((s) => s.source))];
          return cites.length ? `${answer}\n\nSources: ${cites.map((s) => `[${s}]`).join(' ')}` : answer;
        },
      },
      {
        id: `${ns}.ingest`,
        namespace: ns,
        name: 'ingest',
        description: 'Add knowledge to the brain (text/csv/json). Becomes scoped, retrievable, and triggers fan-out agents.',
        inputSchema: { type: 'object', properties: { content: { type: 'string' }, format: { type: 'string' }, source: { type: 'string' } }, required: ['content'] },
        call: async (args, scopes) => {
          const r = await this.brain.ingest(
            { format: (args.format as 'text' | 'csv' | 'json') ?? 'text', content: str(args.content), source: args.source ? str(args.source) : undefined },
            scopes,
          );
          return `Ingested ${r.ingested} record(s) as "${r.source}" under scope "${r.scope}".`;
        },
      },
      {
        id: `${ns}.list_sources`,
        namespace: ns,
        name: 'list_sources',
        description: 'List provenance sources in the brain (within the allowed scopes) with record counts.',
        inputSchema: { type: 'object', properties: {} },
        call: async (_args, scopes) => {
          const stats = await this.brain.knowledgeStats(scopes);
          return stats.length ? stats.map((s) => `- ${s.source}: ${s.count}`).join('\n') : 'The brain is empty (within the allowed scopes).';
        },
      },
    ];
  }

  async close(): Promise<void> {
    /* in-process; nothing to release */
  }
}

/** Aggregates many tool sources into one namespaced registry. */
export class ToolFabric {
  private specs = new Map<string, ToolSpec>();
  constructor(private readonly sources: ToolSource[]) {}

  /** Connect/refresh: pull tools from every source and namespace them. */
  async refresh(): Promise<void> {
    this.specs.clear();
    for (const source of this.sources) {
      for (const spec of await source.list()) {
        // Defensive: ensure the id is namespaced even if a source forgot.
        const id = spec.id.includes('.') ? spec.id : `${source.namespace}.${spec.name}`;
        this.specs.set(id, { ...spec, id });
      }
    }
  }

  list(): ToolSpec[] {
    return [...this.specs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): ToolSpec | undefined {
    return this.specs.get(id);
  }

  /** Invoke a tool by id, threading the caller's access scopes. */
  async call(id: string, args: Record<string, unknown>, scopes: string[]): Promise<string> {
    const spec = this.specs.get(id);
    if (!spec) throw new Error(`Unknown tool: ${id}`);
    return spec.call(args, scopes);
  }

  async close(): Promise<void> {
    for (const s of this.sources) await s.close();
  }
}
