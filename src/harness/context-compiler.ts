/**
 * The context compiler — ONE deterministic prompt assembler.
 *
 * Prompt assembly was string-gluing scattered across call sites; each glue
 * point was an unbudgeted, untraceable decision. The compiler makes assembly a
 * pure function over typed sections: each section declares a priority and an
 * optional token cap; the compiler fits them into the window budget HIGHEST
 * priority first, truncating or dropping the LOWEST first when budget runs
 * out. The result reports exactly what made it in (tokens, truncated, dropped
 * per section) — the substrate for prompt-in-trace observability.
 */

import { estimateTokens } from './tokens.js';

export interface PromptSection {
  id: string; // 'instruction' | 'memory' | 'grounding' | 'task' | …
  content: string;
  /** Higher survives longer. Equal priorities keep insertion order. */
  priority: number;
  /** Per-section token cap (truncate-to-fit). Default: unlimited. */
  maxTokens?: number;
}

export interface CompiledSection {
  id: string;
  tokens: number;
  truncated: boolean;
  dropped: boolean;
}

export interface CompiledPrompt {
  prompt: string;
  sections: CompiledSection[];
  totalTokens: number;
}

/** Truncate content to ≤maxTokens (tokenizer-agnostic via binary chop). */
function clip(content: string, maxTokens: number): string {
  if (estimateTokens(content) <= maxTokens) return content;
  let lo = 0;
  let hi = content.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(content.slice(0, mid)) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return content.slice(0, lo);
}

export function compileContext(sections: PromptSection[], windowTokens: number): CompiledPrompt {
  // Allocate budget by priority (desc, stable); render in ORIGINAL order —
  // importance decides survival, position stays author-controlled.
  const order = sections.map((s, i) => ({ s, i }));
  const byPriority = [...order].sort((a, b) => b.s.priority - a.s.priority || a.i - b.i);

  let remaining = windowTokens;
  const kept = new Map<number, { content: string; tokens: number; truncated: boolean }>();
  for (const { s, i } of byPriority) {
    if (!s.content.trim()) continue;
    const cap = Math.min(s.maxTokens ?? Infinity, remaining);
    if (cap <= 0) continue; // dropped — no budget left
    const content = clip(s.content, cap);
    const tokens = estimateTokens(content);
    if (tokens === 0) continue;
    kept.set(i, { content, tokens, truncated: content.length < s.content.length });
    remaining -= tokens;
  }

  const parts: string[] = [];
  const report: CompiledSection[] = [];
  let total = 0;
  for (const { s, i } of order) {
    const k = kept.get(i);
    report.push({
      id: s.id,
      tokens: k?.tokens ?? 0,
      truncated: k?.truncated ?? false,
      dropped: !k && !!s.content.trim(),
    });
    if (k) {
      parts.push(k.content);
      total += k.tokens;
    }
  }
  return { prompt: parts.join('\n\n'), sections: report, totalTokens: total };
}
