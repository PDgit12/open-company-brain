/**
 * The harness — bring ANY agent and run it on the governed kernel.
 *
 * `Agent` is the one seam every runtime implements. The OS doesn't care whether
 * an agent is our built-in brain call, a tool-using loop over the fabric, or an
 * external framework (LangGraph/CrewAI/Hermes) wrapped in an adapter — they all
 * run through the same governed context: access scopes, the Tool Fabric, and a
 * recorded trace of every step (the basis for budgets/approval/audit in K3).
 *
 * Two adapters ship here:
 *   • BuiltinAgent  — one grounded, cited brain call. Works on every backend.
 *   • ToolLoopAgent — a real agentic loop: a tool-capable model (Ollama) picks
 *     tools from the fabric, we execute them (scope-gated), feed results back,
 *     and iterate until it answers. This is where "any tool / any MCP" pays off.
 */

import { config } from '../config.js';
import { postJson } from './http.js';
import type { Brain } from '../brain/brain.js';
import type { ToolFabric, ToolSpec } from '../tools/fabric.js';

export interface AgentContext {
  brain: Brain;
  fabric: ToolFabric;
  scopes: string[];
  /** Live progress hooks (the CLI uses these to render like a coding agent). */
  onStatus?: (msg: string) => void;
  onStep?: (step: AgentStep) => void;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export interface AgentResult {
  output: string;
  steps: AgentStep[];
}

export interface Agent {
  readonly name: string;
  run(task: string, ctx: AgentContext): Promise<AgentResult>;
}

/** The simplest agent: one grounded, cited brain answer. Backend-agnostic. */
export class BuiltinAgent implements Agent {
  readonly name = 'builtin';
  async run(task: string, ctx: AgentContext): Promise<AgentResult> {
    ctx.onStatus?.('thinking');
    const { answer, sources } = await ctx.brain.ask(task, ctx.scopes);
    const cites = [...new Set(sources.map((s) => s.source))];
    const output = cites.length ? `${answer}\n\nSources: ${cites.map((s) => `[${s}]`).join(' ')}` : answer;
    return { output, steps: [] };
  }
}

// ── Tool-loop agent (Ollama tool calling) ────────────────────────────────────

/** Fabric ids contain dots ("brain.search"); function names must not. */
export function sanitizeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '__');
}

/** Map fabric tools → the Ollama /api/chat `tools` array, with a name↔id map. */
export function toOllamaTools(specs: ToolSpec[]): {
  tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  byName: Map<string, string>;
} {
  const byName = new Map<string, string>();
  const tools = specs.map((s) => {
    const name = sanitizeName(s.id);
    byName.set(name, s.id);
    return {
      type: 'function' as const,
      function: { name, description: s.description, parameters: s.inputSchema },
    };
  });
  return { tools, byName };
}

interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}
interface OllamaMessage {
  role: string;
  content?: string;
  tool_calls?: OllamaToolCall[];
}

const SYSTEM = `You are an agent running on a governed knowledge OS. Use the provided tools to gather grounded facts before answering. Prefer the brain.* tools for company knowledge. Cite sources. If you cannot ground an answer, say so plainly — never invent.`;

/**
 * Clamp a tool result before it enters the conversation. A connected MCP tool
 * can return megabytes; unclamped, one call silently blows the context window
 * and the server truncates from the top — clipping the system prompt first.
 * ~24k chars ≈ 6k tokens: generous for real results, safe for small windows.
 */
export const MAX_TOOL_RESULT_CHARS = 24_000;
export function clampToolResult(s: string, max = MAX_TOOL_RESULT_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} of ${s.length} chars — refine the tool call for more]`;
}

export class ToolLoopAgent implements Agent {
  readonly name = 'tools';
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly maxSteps = 6,
  ) {}

  async run(task: string, ctx: AgentContext): Promise<AgentResult> {
    const { tools, byName } = toOllamaTools(ctx.fabric.list());
    const messages: OllamaMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: task },
    ];
    const steps: AgentStep[] = [];

    for (let i = 0; i < this.maxSteps; i++) {
      ctx.onStatus?.('thinking');
      const msg = await this.chat(messages, tools);
      messages.push(msg);
      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        return { output: msg.content ?? '', steps };
      }
      for (const call of calls) {
        const id = byName.get(call.function.name) ?? call.function.name;
        const args = typeof call.function.arguments === 'string'
          ? safeJson(call.function.arguments)
          : call.function.arguments;
        let result: string;
        try {
          result = clampToolResult(await ctx.fabric.call(id, args, ctx.scopes));
        } catch (err) {
          result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
        const step = { tool: id, args, result };
        steps.push(step);
        ctx.onStep?.(step);
        messages.push({ role: 'tool', content: result });
      }
    }
    // Budget exhausted: ask for a final answer from what we have.
    const final = await this.chat([...messages, { role: 'user', content: 'Give your best grounded final answer now.' }], tools);
    return { output: final.content ?? '(no answer — step budget exhausted)', steps };
  }

  private async chat(messages: OllamaMessage[], tools: unknown[]): Promise<OllamaMessage> {
    const json = await postJson<{ message?: OllamaMessage }>(
      `${this.baseUrl}/api/chat`,
      { model: this.model, messages, tools, stream: false, keep_alive: config.ollama.keepAlive },
      { label: 'Ollama chat' },
    );
    return json.message ?? { role: 'assistant', content: '' };
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
