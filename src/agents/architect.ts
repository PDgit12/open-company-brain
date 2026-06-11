/**
 * The agent architect — one prompt in, a complete agent out.
 *
 * `comb new "<what you want>"` turns a plain-language wish into everything the
 * harness needs: a saved agent definition (name + instruction + retrieval
 * query) AND a starter calibration-label set (answerable + unanswerable
 * queries) so the grounding floor can be placed for it. On a live backend the
 * local model drafts these; on mock (or if the model emits junk) a
 * deterministic fallback builds a sane draft from the prompt itself — the
 * command always succeeds, the model only improves the result.
 */

import { config } from '../config.js';
import { postJson } from '../harness/http.js';
import type { SaveAgentInput } from './registry.js';
import type { LabeledQuery } from '../brain/grounding.js';

export interface AgentDraft extends SaveAgentInput {
  query: string;
  labels: LabeledQuery[];
  /** Where the draft came from — surfaced to the user. */
  draftedBy: 'model' | 'fallback';
}

const ARCHITECT_PROMPT = (wish: string): string =>
  `You design no-code agents for a governed company-knowledge system. The agent
answers ONLY from retrieved company records and refuses otherwise.

Design an agent for this request: "${wish}"

Reply with ONLY a JSON object, no prose:
{
  "name": "<2-4 word agent name>",
  "instruction": "<2-3 sentences: what the agent does with retrieved records; tell it to be concise and cite sources>",
  "query": "<4-8 keywords describing what to retrieve when run without a specific question>",
  "answerable": ["<question this agent's data should answer>", "<another>"],
  "unanswerable": ["<plausible question its data will NOT contain>", "<another>"]
}`;

/** Extract and validate the first JSON object in a model reply. Null on junk. */
export function parseAgentDraft(text: string): Omit<AgentDraft, 'draftedBy'> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const instruction = typeof raw.instruction === 'string' ? raw.instruction.trim() : '';
    const query = typeof raw.query === 'string' ? raw.query.trim() : '';
    if (!name || !instruction || !query) return null;
    const toLabels = (v: unknown, answerable: boolean): LabeledQuery[] =>
      Array.isArray(v)
        ? v.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
            .map((q) => ({ query: q.trim(), answerable }))
        : [];
    return {
      name,
      instruction,
      query,
      labels: [...toLabels(raw.answerable, true), ...toLabels(raw.unanswerable, false)],
    };
  } catch {
    return null;
  }
}

const FALLBACK_UNANSWERABLE: LabeledQuery[] = [
  { query: 'What is the weather forecast for next Tuesday?', answerable: false },
  { query: 'Summarize our acquisition of Initech in 1999', answerable: false },
];

/** Deterministic draft from the prompt alone — works with zero credentials. */
export function fallbackDraft(wish: string): AgentDraft {
  const words = wish
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const name = (words.slice(0, 3).join(' ') || 'Custom Agent')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const query = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 8).join(' ') || wish;
  return {
    name,
    instruction:
      `${wish.trim()}. Answer only from the retrieved company records, be concise, and cite your sources. ` +
      `If the records don't contain the answer, say so plainly.`,
    query,
    labels: [
      { query: wish.trim(), answerable: true },
      ...FALLBACK_UNANSWERABLE,
    ],
    draftedBy: 'fallback',
  };
}

/**
 * One prompt → a complete draft. The model improves it; it never blocks it.
 *
 * NOTE: this deliberately does NOT go through createGenerator() — that path
 * injects the cite-or-refuse SYSTEM_PROMPT, and a governed model correctly
 * refuses to "answer" a design request with no retrieved context. Designing an
 * agent is generation, not grounded Q&A, so the architect calls the local
 * model directly with its own system role. (Local backend only; elsewhere the
 * deterministic fallback applies.)
 */
export async function draftAgent(wish: string): Promise<AgentDraft> {
  if (config.backend !== 'local') return fallbackDraft(wish);
  try {
    const json = await postJson<{ message?: { content?: string } }>(
      `${config.ollama.baseUrl}/api/chat`,
      {
        model: config.ollama.generationModel,
        stream: false,
        keep_alive: config.ollama.keepAlive,
        format: 'json',
        messages: [
          { role: 'system', content: 'You design agents. Reply with ONLY the requested JSON object.' },
          { role: 'user', content: ARCHITECT_PROMPT(wish) },
        ],
      },
      { label: 'Agent architect' },
    );
    const parsed = parseAgentDraft(json.message?.content ?? '');
    if (parsed) return { ...parsed, draftedBy: 'model' };
  } catch {
    // model unavailable → deterministic path below
  }
  return fallbackDraft(wish);
}
