/**
 * The generation layer — turns (system prompt + grounded prompt) into an answer.
 *
 *   • LangbasePipe   — runs a real Langbase Pipe (LLM) in LIVE mode.
 *   • MockGenerator  — deterministic, no LLM: it formats the retrieved context
 *     into a readable briefing/answer and honours the trust contract (it returns
 *     the "I don't have that" line when there is no context). This is what makes
 *     the showcase work with zero credentials AND makes the contract testable.
 */

import type { Langbase } from 'langbase';
import { config } from '../config.js';
import { postJson } from '../harness/http.js';
import { SYSTEM_PROMPT } from './prompts.js';
import type { RetrievedChunk } from '../brain/memory.js';

export const NO_CONTEXT_REPLY = "I don't have that in the brain yet.";

/** Returned by generation surfaces when no real model is configured — so a real
 *  user gets honest guidance to the working paths, never a faked mock answer. */
export const NO_MODEL_MESSAGE =
  'No generation model is configured, so Comb will not fabricate an answer. ' +
  'Use search_brain to get the cited records and let your connected agent (Claude/Cursor) write the answer, ' +
  'or set LLM_BACKEND=local (Ollama) or openai to let Comb generate.';

/**
 * The DRAFTING system role. Grounding is already verified by the gate before
 * generation, so this prompt must NOT tell the model to refuse (the Q&A
 * SYSTEM_PROMPT does — which made small models emit the refusal line on
 * draft/act tasks). It directs the model to produce the requested artifact
 * from the context, citing sources.
 */
export const DRAFT_SYSTEM = `You write documents and drafts grounded in the provided CONTEXT for an organization.
- Produce exactly what is asked (a notice, summary, reply, update). Do NOT refuse — the context has been verified to contain relevant facts.
- Use only facts from the CONTEXT. Cite sources inline like [source-name]. Never invent names, numbers, or dates.
- Be concise, clear, and ready to send.`;

export interface GenerateInput {
  prompt: string;
  /** The chunks that grounded this prompt — used by the mock to format output. */
  chunks: RetrievedChunk[];
  /** Override the system role (e.g. a DRAFTING role instead of cite-or-refuse Q&A). */
  system?: string;
}

export interface Generator {
  generate(input: GenerateInput): Promise<string>;
}

export class MockGenerator implements Generator {
  async generate({ chunks }: GenerateInput): Promise<string> {
    // Trust contract: no grounding → refuse, exactly like the real prompt demands.
    if (chunks.length === 0) return NO_CONTEXT_REPLY;

    const header = '## Answer (grounded in the brain)\n';

    const facts = chunks
      .map((c, i) => `- ${c.text.split('\n').join(' · ')}  _[${c.source} · #${i + 1}]_`)
      .join('\n');

    return (
      `${header}\n` +
      `${facts}\n\n` +
      `_Mock generator: deterministic formatting of retrieved records. ` +
      `In LIVE mode a Langbase Pipe writes this as prose with the same sources._`
    );
  }
}

export class LangbasePipe implements Generator {
  private readonly apiKey: string;
  private readonly pipeName: string;
  private lb: Langbase | undefined;

  constructor(apiKey: string, pipeName: string) {
    this.apiKey = apiKey;
    this.pipeName = pipeName;
  }

  // Lazy SDK load — keeps the langbase/openai/node-fetch tree out of module
  // load so the model-free default never pays for a generation backend it
  // doesn't use. Only invoked when the langbase backend is actually selected.
  private async client(): Promise<Langbase> {
    if (!this.lb) {
      const { Langbase } = await import('langbase');
      this.lb = new Langbase({ apiKey: this.apiKey });
    }
    return this.lb;
  }

  async generate({ prompt }: GenerateInput): Promise<string> {
    const lb = await this.client();
    const res = await lb.pipes.run({
      name: this.pipeName,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      stream: false,
    });
    return res.completion ?? '';
  }
}

/** Local generation via a running Ollama server (e.g. llama3.2). $0/call. */
export class OllamaGenerator implements Generator {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  async generate({ prompt, system }: GenerateInput): Promise<string> {
    const json = await postJson<{ message?: { content?: string } }>(
      `${this.baseUrl}/api/chat`,
      {
        model: this.model,
        stream: false,
        keep_alive: config.ollama.keepAlive,
        // Deterministic generation: grounded work is a fact pipeline, not
        // creative writing. Default temperature flips the same input between
        // outputs run to run — untestable. Greedy decoding pins it.
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: system ?? SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      },
      { label: 'Ollama chat' },
    );
    return json.message?.content ?? '';
  }
}

/**
 * BYO-key generation via the OpenAI-compatible chat protocol. One class covers
 * OpenAI, Groq, Together, OpenRouter, LM Studio, vLLM, … — point OPENAI_BASE_URL
 * at the provider and supply OPENAI_API_KEY (some local servers accept any key).
 */
export class OpenAIGenerator implements Generator {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generate({ prompt, system }: GenerateInput): Promise<string> {
    const json = await postJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        messages: [
          { role: 'system', content: system ?? SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      },
      { label: 'OpenAI-compatible chat', headers: { authorization: `Bearer ${this.apiKey}` } },
    );
    return json.choices?.[0]?.message?.content ?? '';
  }
}

export function createGenerator(): Generator {
  if (config.backend === 'local') {
    return new OllamaGenerator(config.ollama.baseUrl, config.ollama.generationModel);
  }
  if (config.backend === 'openai' && config.openai.apiKey) {
    return new OpenAIGenerator(config.openai.baseUrl, config.openai.apiKey, config.openai.model);
  }
  if (config.backend === 'langbase' && config.langbase.apiKey) {
    return new LangbasePipe(config.langbase.apiKey, config.langbase.pipeName);
  }
  return new MockGenerator();
}
