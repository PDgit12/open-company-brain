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

Hard rules:
- Use only facts present in the CONTEXT block. Never invent names, dates, or figures.
- Cite the source of each fact inline like [source-name] (the source label is shown on each context item).
- If the context does not contain the answer, say plainly: "I don't have that in the brain yet." Do not guess. (Prevent false positives — silence beats a confident wrong answer.)
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
  return `Question from a user: ${question}
${buildExemplarBlock(examples)}
Answer using only the context. Cite sources.

CONTEXT:
${context}`;
}

/** Instruction for the attention summary — used by the health agent. */
export function buildHealthPrompt(context: string): string {
  return `Review the records below and flag what needs attention:
open action items, unanswered questions, upcoming deadlines, risks, and anything overdue or stale.
Use only the context; cite sources. Be brief and prioritized.

CONTEXT:
${context}`;
}
