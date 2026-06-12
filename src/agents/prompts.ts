/**
 * Prompt construction — pure functions, no I/O.
 *
 * The trust contract lives here: the system prompt forbids ungrounded claims and
 * requires citations. We also assemble the context block from retrieved chunks
 * so the same grounding logic is testable in isolation.
 */

import type { RetrievedChunk } from '../brain/memory.js';

export const SYSTEM_PROMPT = `You are an organization's knowledge brain.
You answer questions and draft text using ONLY the context provided.

How to decide, in order:
1. Read every CONTEXT item and look for information that answers the question —
   the context rarely uses the question's exact words. A synonym or paraphrase
   STILL COUNTS: "up to $60/day" answers "what is the limit?"; "closes at 6 pm"
   answers "what time does it shut?". If the fact is there in any wording,
   ANSWER with it and cite.
2. Only if no context item contains the information, say plainly:
   "I don't have that in the brain yet." Do not guess.

Worked example — context says: "The office closes at 6 pm."
  Q: "What time does the office shut?" → "The office closes at 6 pm [handbook]."  (paraphrase → answer)
  Q: "When does the gym open?"        → "I don't have that in the brain yet."     (absent → refuse)

Hard rules:
- Use only facts present in the CONTEXT block. Never invent names, dates, or figures.
- Cite the source of each fact inline like [source-name] (the source label is shown on each context item).
- Stay strictly on the task asked. Do not drift into unrelated topics or pad the answer.
- Be honest, not agreeable. If the context contradicts the user's assumption, say so directly. Do not flatter, do not simply agree to please — being a "yes-man" is a failure.
- Be concise and scannable. Lead with what the reader most needs to know.`;

/** Build the grounded context block fed to the model. */
export function buildContextBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return '(no matching records found in the brain)';
  }
  return chunks
    .map((c, i) => `[#${i + 1} source=${c.source}]\n${c.text}`)
    .join('\n\n---\n\n');
}

export interface Exemplar {
  query: string;
  answer: string;
}

/** Render approved past answers as few-shot exemplars (learning loop). */
export function buildExemplarBlock(examples: Exemplar[]): string {
  if (!examples.length) return '';
  const shown = examples
    .map((e, i) => `Example ${i + 1}:\nQ: ${e.query}\nA: ${e.answer}`)
    .join('\n\n');
  return `\nHere are past answers a human approved — match their style and rigor:\n${shown}\n`;
}

export function buildAskPrompt(question: string, context: string, examples: Exemplar[] = []): string {
  // Context FIRST, question LAST: small models weight recent tokens most, so
  // the question sits closest to the answer position with the evidence already
  // read — measurably reduces over-refusal on paraphrased questions (≤3B).
  return `CONTEXT:
${context}
${buildExemplarBlock(examples)}
Question from a user: ${question}

Answer the question using only the context above (paraphrased wording in the
context still counts). Cite sources like [source-name].`;
}

/** Instruction for the attention summary — used by the health agent. */
export function buildHealthPrompt(context: string): string {
  return `Review the records below and flag what needs attention:
open action items, unanswered questions, upcoming deadlines, risks, and anything overdue or stale.
Use only the context; cite sources. Be brief and prioritized.

CONTEXT:
${context}`;
}
