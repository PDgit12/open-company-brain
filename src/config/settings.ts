/**
 * Runtime settings — let a user change the backend/retrieval/keys/S3 from the
 * API (and, in Phase 2, the webapp) instead of hand-editing .env. Writes are
 * persisted to .env and take effect on restart (config is parsed once at boot;
 * we don't fake a hot-swap). Secret values are written but NEVER read back.
 *
 * SAFETY: only an allow-listed set of keys is settable, enum values are
 * validated, and every value is sanitized to a single line so an API caller
 * can't inject extra env lines.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../config.js';

const ENV_FILE = '.env';

/**
 * Keys a user may set over the API. Anything else is rejected, not written.
 *
 * SECURITY: endpoint + storage-LOCATION settings are deliberately NOT here —
 * `OPENAI_BASE_URL`, `OLLAMA_BASE_URL`, `VECTOR_DATABASE_URL`,
 * `COMB_S3_VECTOR_BUCKET`/`_INDEX`. Allowing those over the network would let a
 * write-authorized (or, on an unauthenticated deployment, any) caller redirect
 * generation / embeddings / vector storage to attacker-controlled infrastructure
 * and exfiltrate company data. Those are set ONLY via the trusted local channel
 * (`.env` / `comb init`). The API may change preferences, model names, region,
 * and provider keys — never where data is sent.
 */
const SETTABLE = new Set([
  'LLM_BACKEND',
  'COMB_RETRIEVAL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'LANGBASE_API_KEY',
  'COMB_AWS_REGION',
  'OLLAMA_GENERATION_MODEL',
  'OLLAMA_EMBEDDING_MODEL',
]);

/** Enum-validated keys — an out-of-range value is rejected. */
const ENUMS: Record<string, readonly string[]> = {
  LLM_BACKEND: ['auto', 'mock', 'langbase', 'local', 'openai'],
  COMB_RETRIEVAL: ['vector', 'keyword'],
};

/** The current config a UI can show — booleans for secrets, never the values. */
export interface SafeConfig {
  backend: string;
  retrieval: string;
  openaiKeySet: boolean;
  langbaseKeySet: boolean;
  vectorDbSet: boolean;
  s3: { bucket?: string; index?: string; region: string };
  /** What the user must do for a change to take effect. */
  note: string;
}

export function readConfig(): SafeConfig {
  return {
    backend: config.backend,
    retrieval: config.comb.retrieval,
    openaiKeySet: Boolean(config.openai.apiKey),
    langbaseKeySet: Boolean(config.langbase.apiKey),
    vectorDbSet: Boolean(config.ollama.vectorDatabaseUrl),
    s3: { bucket: config.s3.bucket, index: config.s3.index, region: config.s3.region },
    note: 'Changes are saved to .env and take effect after a restart.',
  };
}

/** Strip CR/LF so a value can never inject another env line. */
export function sanitizeValue(v: unknown): string {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/** Set or append a single KEY=value line (KEY is already allow-listed). */
export function setEnvLine(text: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
}

export interface WriteResult {
  updated: string[];
  rejected: string[];
}

/** Apply allow-listed, validated, sanitized updates to .env. Pure-ish: the only
 *  side effect is the .env write, and only when something actually changed. */
export async function writeConfig(updates: Record<string, unknown>): Promise<WriteResult> {
  let text = '';
  try {
    text = await readFile(ENV_FILE, 'utf8');
  } catch {
    text = ''; // no .env yet — we'll create it
  }
  const updated: string[] = [];
  const rejected: string[] = [];
  for (const [rawKey, rawVal] of Object.entries(updates)) {
    const key = rawKey.toUpperCase();
    if (!SETTABLE.has(key)) {
      rejected.push(rawKey);
      continue;
    }
    const value = sanitizeValue(rawVal);
    const allowed = ENUMS[key];
    if (allowed && value && !allowed.includes(value)) {
      rejected.push(rawKey);
      continue;
    }
    text = setEnvLine(text, key, value);
    updated.push(key);
  }
  if (updated.length) await writeFile(ENV_FILE, text);
  return { updated, rejected };
}
