/**
 * Constrained decoding, two-stage: SELECT then COMPOSE.
 *
 * Stage A — SELECT: "which numbered context items are relevant?" → {relevant:[ids]}.
 *   Pure recognition — the task class ≤3B models are reliably good at.
 *   REFUSAL IS NOW STRUCTURAL: an empty selection refuses with zero prose
 *   judgment involved; the model never has to "choose to refuse" in words.
 *
 * Stage B — COMPOSE: the model writes the answer over ONLY the selected
 *   chunks (a re-numbered, distractor-free context) and cites by index.
 *   Smaller context → less confusion; citations stay a subset proof.
 *
 * Every stage is grammar-constrained (Ollama format:<schema>), validated in
 * code, and degrades gracefully: invalid SELECT → single-shot compose over all
 * chunks (the phase-2 path); invalid COMPOSE after one named-violation repair
 * → null → the caller's legacy prose path. The pipeline bends, never breaks.
 *
 * The model caller is INJECTED (Llm type) so the whole pipeline is hermetic in
 * tests; generateStructured wires the real Ollama caller.
 */

import { config } from '../config.js';
import { postJson } from '../harness/http.js';
import { buildAskPrompt, buildContextBlock } from '../agents/prompts.js';
import { answered, refusal, type AnswerRecord } from './record.js';
import type { RetrievedChunk } from './memory.js';

export const SELECT_SCHEMA = {
  type: 'object',
  properties: { relevant: { type: 'array', items: { type: 'integer' } } },
  required: ['relevant'],
} as const;

export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['answered', 'insufficient_context'] },
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
  },
  required: ['status', 'answer', 'citations'],
} as const;

/**
 * SELECT is RECALL-BIASED by design: over-inclusion is safe (COMPOSE still
 * gates over the selected set), but a false exclusion loses the answer. Found
 * live: a strict "which items are RELEVANT" framing made a 3B return [] for
 * obviously relevant items — the empty array is the easiest valid completion
 * under a grammar. Plain "ITEM n:" numbering + "anything related, include when
 * unsure" + a single user message fixed it on the same model.
 */
const SELECT_SYSTEM = 'Reply ONLY with the JSON object.';

function selectPrompt(task: string, chunks: RetrievedChunk[]): string {
  const items = chunks
    .map((c, i) => `ITEM ${i + 1}: ${c.text.replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n\n');
  return `QUESTION: ${task}\n\n${items}\n\nWhich ITEM numbers mention ANYTHING related to the question (synonyms and paraphrases count)? When unsure, include it. Use an empty array only if nothing relates.`;
}

// EXACT wording matters at 3B scale — discovered the hard way, twice. This is
// the empirically-working phase-2 formula: positive decision framing ("decide
// whether answerable", "if present in ANY wording, answered") + the paraphrase
// example. Variants that mentioned refusal last, or dropped the trailing
// imperative in the prompt, made the same model refuse over a chunk literally
// containing the answer. Do not rewrite this without re-running the live A/B.
const COMPOSE_SYSTEM = `You are a grounded answer engine. Decide from the numbered CONTEXT items whether the request is answerable.
- Paraphrases COUNT: "up to $60/day" answers "what is the limit?". If the information is present in any wording, status="answered".
- citations = the numbers of the context items that support the answer (e.g. [1,3]).
- If the information is genuinely absent from every item: status="insufficient_context", answer="", citations=[].
Reply ONLY with the JSON object.`;

/** Injected model caller: system + user prompt + schema → raw text reply. */
export type Llm = (system: string, prompt: string, schema: object) => Promise<string>;

/** Parse + validate a SELECT reply. Null = invalid (fall back to single-shot). */
export function parseSelect(text: string, max: number): number[] | null {
  try {
    const raw = JSON.parse(text) as { relevant?: unknown };
    if (!Array.isArray(raw.relevant)) return null;
    const out: number[] = [];
    for (const n of raw.relevant) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > max) return null;
      if (!out.includes(n)) out.push(n);
    }
    return out;
  } catch {
    return null;
  }
}

/** Parse + validate a COMPOSE reply into a record. Null = invalid (repair). */
export function parseStructured(text: string, chunks: RetrievedChunk[]): AnswerRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { status?: unknown; answer?: unknown; citations?: unknown };
  if (r.status === 'insufficient_context') return refusal();
  if (r.status !== 'answered') return null;
  if (typeof r.answer !== 'string' || !r.answer.trim()) return null;
  if (!Array.isArray(r.citations) || r.citations.length === 0) return null;
  const cited: RetrievedChunk[] = [];
  for (const c of r.citations) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > chunks.length) return null;
    cited.push(chunks[c - 1]!);
  }
  return answered(r.answer.trim(), [...new Map(cited.map((c) => [c.source + c.text, c])).values()]);
}

/** COMPOSE over a chunk set, with one named-violation repair retry. */
async function compose(llm: Llm, task: string, chunks: RetrievedChunk[]): Promise<AnswerRecord | null> {
  // buildAskPrompt = context first, question last, trailing IMPERATIVE — the
  // empirically-working shape (the imperative after the question is load-
  // bearing at 3B scale; "REQUEST: q" alone regressed to refusals).
  const prompt = buildAskPrompt(task, buildContextBlock(chunks));
  const first = parseStructured(await llm(COMPOSE_SYSTEM, prompt, ANSWER_SCHEMA), chunks);
  if (first) return first;
  const repaired = await llm(
    COMPOSE_SYSTEM,
    `${prompt}\n\nYour previous reply was invalid (bad status, empty answer, or citations not in 1..${chunks.length}). Reply again with ONLY the valid JSON object.`,
    ANSWER_SCHEMA,
  );
  return parseStructured(repaired, chunks);
}

/** The two-stage pipeline, model-caller injected (hermetically testable). */
export async function runStructuredPipeline(
  llm: Llm,
  task: string,
  chunks: RetrievedChunk[],
): Promise<AnswerRecord | null> {
  // Stage A — SELECT (single attempt; invalid → degrade to single-shot).
  let selected: RetrievedChunk[] | null = null;
  try {
    const sel = parseSelect(await llm(SELECT_SYSTEM, selectPrompt(task, chunks), SELECT_SCHEMA), chunks.length);
    if (sel !== null) {
      if (sel.length === 0) return refusal(); // structural refusal — no prose involved
      selected = sel.map((n) => chunks[n - 1]!);
    }
  } catch {
    selected = null;
  }
  // Stage B — COMPOSE over the selected (or all, when SELECT degraded).
  try {
    return await compose(llm, task, selected ?? chunks);
  } catch {
    return null;
  }
}

const ollamaLlm: Llm = async (system, prompt, schema) => {
  const json = await postJson<{ message?: { content?: string } }>(
    `${config.ollama.baseUrl}/api/chat`,
    {
      model: config.ollama.generationModel,
      stream: false,
      keep_alive: config.ollama.keepAlive,
      options: { temperature: 0 },
      format: schema, // grammar-constrained decoding
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    },
    { label: 'Ollama structured' },
  );
  return json.message?.content ?? '';
};

/** Production entry: local backend → the pipeline; elsewhere null (legacy path). */
export async function generateStructured(
  task: string,
  chunks: RetrievedChunk[],
): Promise<AnswerRecord | null> {
  if (config.backend !== 'local') return null; // openai structured outputs: follow-up
  return runStructuredPipeline(ollamaLlm, task, chunks);
}
