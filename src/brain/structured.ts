/**
 * Constrained decoding — the model fills the AnswerRecord schema DIRECTLY.
 *
 * Phase 1 built the typed contract but constructed it in code around a prose
 * generation. Phase 2 hands the model the schema itself: Ollama's
 * `format: <json-schema>` grammar-constrains decoding, so the reply is
 * structurally valid JSON by construction. The model's judgment becomes two
 * fields: a STATUS decision and a CITATION selection (context item numbers) —
 * and code verifies both before anything downstream sees them:
 *
 *   · status must be in the enum
 *   · citations must be valid #indexes into the chunks WE retrieved (subset
 *     proof — the model cannot cite what wasn't there)
 *   · 'answered' requires a non-empty answer AND ≥1 citation
 *   · 'insufficient_context' is normalized to the canonical refusal record
 *
 * One repair retry on an invalid reply (with the violation named), then a
 * graceful fallback to the legacy prose path — the pipeline degrades, never
 * breaks. Citing by INDEX doubles as a lightweight SELECT step: the model must
 * point at evidence, which is selection (easy for ≤3B models), not prose
 * discipline (hard for them).
 */

import { config } from '../config.js';
import { postJson } from '../harness/http.js';
import { answered, refusal, type AnswerRecord } from './record.js';
import type { RetrievedChunk } from './memory.js';

/** The grammar handed to the model. Indexes are 1-based (#1..#N as shown). */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['answered', 'insufficient_context'] },
    answer: { type: 'string' },
    citations: { type: 'array', items: { type: 'integer' } },
  },
  required: ['status', 'answer', 'citations'],
} as const;

export const STRUCTURED_SYSTEM = `You are a grounded answer engine. Decide from the numbered CONTEXT items whether the request is answerable.
- Paraphrases COUNT: "up to $60/day" answers "what is the limit?". If the information is present in any wording, status="answered".
- citations = the numbers of the context items that support the answer (e.g. [1,3]).
- If the information is genuinely absent from every item: status="insufficient_context", answer="", citations=[].
Reply ONLY with the JSON object.`;

/** Parse + validate a model reply into a record. Null = invalid (caller repairs). */
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
  // Subset proof: every citation must be a valid 1-based index into OUR chunks.
  const cited: RetrievedChunk[] = [];
  for (const c of r.citations) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > chunks.length) return null;
    cited.push(chunks[c - 1]!);
  }
  return answered(r.answer.trim(), [...new Map(cited.map((c) => [c.source + c.text, c])).values()]);
}

async function ollamaStructured(prompt: string): Promise<string> {
  const json = await postJson<{ message?: { content?: string } }>(
    `${config.ollama.baseUrl}/api/chat`,
    {
      model: config.ollama.generationModel,
      stream: false,
      keep_alive: config.ollama.keepAlive,
      options: { temperature: 0 },
      format: ANSWER_SCHEMA, // grammar-constrained decoding
      messages: [
        { role: 'system', content: STRUCTURED_SYSTEM },
        { role: 'user', content: prompt },
      ],
    },
    { label: 'Ollama structured' },
  );
  return json.message?.content ?? '';
}

/**
 * The structured generation path (local backend). Returns null when the
 * backend can't do it or both attempts produce invalid records — the caller
 * falls back to the legacy prose path. Degrade, never break.
 */
export async function generateStructured(
  prompt: string,
  chunks: RetrievedChunk[],
): Promise<AnswerRecord | null> {
  if (config.backend !== 'local') return null; // openai structured outputs: phase follow-up
  try {
    const first = await ollamaStructured(prompt);
    const parsed = parseStructured(first, chunks);
    if (parsed) return parsed;
    // ONE repair retry, naming the violation.
    const repaired = await ollamaStructured(
      `${prompt}\n\nYour previous reply was invalid (bad status, empty answer, or citations not in 1..${chunks.length}). Reply again with ONLY the valid JSON object.`,
    );
    return parseStructured(repaired, chunks);
  } catch {
    return null; // model down → legacy path
  }
}
