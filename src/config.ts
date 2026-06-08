import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment validation + runtime mode detection.
 *
 * Fail fast and loud on malformed config, but treat ABSENT credentials as an
 * explicit, supported state (MOCK mode) rather than an error — that is what lets
 * the brain run and demo with zero setup.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  LANGBASE_API_KEY: z.string().trim().optional(),
  LANGBASE_MEMORY_NAME: z.string().trim().default('comb'),
  LANGBASE_PIPE_NAME: z.string().trim().default('comb-agent'),
  // Embedding model for recall + generation model for the pipe. Both must match
  // a provider key configured in your Langbase workspace. OpenAI by default.
  LANGBASE_EMBEDDING_MODEL: z
    .enum([
      'openai:text-embedding-3-large',
      'cohere:embed-multilingual-v3.0',
      'cohere:embed-multilingual-light-v3.0',
      'google:text-embedding-004',
    ])
    .default('openai:text-embedding-3-large'),
  LANGBASE_GENERATION_MODEL: z.string().trim().default('openai:gpt-4o-mini'),

  // Backend selection. `auto` = langbase if keyed, else mock. `local` = fully
  // self-hosted (Ollama generation + Ollama embeddings + pgvector recall): $0/query.
  LLM_BACKEND: z.enum(['auto', 'mock', 'langbase', 'local']).default('auto'),
  OLLAMA_BASE_URL: z.string().trim().url().default('http://localhost:11434'),
  OLLAMA_GENERATION_MODEL: z.string().trim().default('llama3.2:1b'),
  OLLAMA_EMBEDDING_MODEL: z.string().trim().default('nomic-embed-text'),
  // How long Ollama keeps the model loaded in memory after a call. Keeping it
  // warm lets the server reuse the loaded weights (and prefix KV) across turns,
  // cutting cold-load latency. Ollama format: '5m', '30s', '-1' (forever), '0'.
  OLLAMA_KEEP_ALIVE: z.string().trim().default('5m'),
  // Vector dimension of the embedding model (nomic-embed-text = 768).
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  // Minimum cosine similarity for a vector hit to count as grounding. Vector
  // search always returns nearest neighbours; without a floor the brain would
  // answer from loosely-related chunks and break the cite-or-refuse contract.
  // Tune per embedding model (nomic-embed-text has a high baseline ~0.4).
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),
  // Postgres holding the pgvector recall table (local backend). Falls back to
  // DATABASE_URL if unset, so one Postgres can serve both data + vectors.
  VECTOR_DATABASE_URL: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
  DATABASE_URL: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
  DEMO_USER_ACCESS_SCOPE: z.string().trim().default('default-team'),
  // Ingest webhook auth. When INGEST_API_KEY is set, POST /api/ingest and the
  // fan-out config routes require it (Authorization: Bearer <key> or x-api-key),
  // and the authenticated caller is granted INGEST_SCOPES. When UNSET, the write
  // path is open — fine for local/mock dev, but set a key for any shared brain.
  INGEST_API_KEY: z.string().trim().optional().or(z.literal('').transform(() => undefined)),
  INGEST_SCOPES: z.string().trim().default(''),
  // Fixed-window-per-minute rate limit for the authenticated write path.
  INGEST_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(120),
  // Action delivery: outbox | file | webhook. `outbox` = record only (default,
  // safe). `file` writes approved actions to a real file. `webhook` POSTs them.
  ACTION_DELIVERY: z.enum(['outbox', 'file', 'webhook']).default('outbox'),
  ACTION_OUTBOX_PATH: z.string().trim().default('outbox'),
  ACTION_WEBHOOK_URL: z.string().trim().default(''),
  // Zero-setup persistence root. Saved agents, per-agent conversation memory,
  // token budgets, and the response cache live here as JSON when no Postgres is
  // configured. Gitignored; mirrors ACTION_OUTBOX_PATH's local-file philosophy.
  COMB_DATA_DIR: z.string().trim().default('.comb'),
  // Per-scope generation token budget. 0 = unlimited (default). When > 0, a
  // saved agent run that would exceed the budget for its scope refuses instead.
  COMB_TOKEN_BUDGET_PER_SCOPE: z.coerce.number().int().min(0).default(0),
  // Response-cache time-to-live (seconds) for deterministic saved-agent runs.
  COMB_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(86400),
  // The model's usable context window, in tokens. The harness packs system +
  // conversation memory + retrieved context + the request to fit inside it,
  // trimming oldest memory first. Default suits small local models (Ollama).
  COMB_CONTEXT_WINDOW_TOKENS: z.coerce.number().int().positive().default(8192),
  // Fraction of the window conversation memory may occupy before older turns are
  // dropped — the rest is reserved for retrieved grounding + the answer.
  COMB_MEMORY_WINDOW_FRACTION: z.coerce.number().min(0).max(1).default(0.35),
  // Token counter. 'heuristic' = zero-dep chars/4 (default, always available).
  // 'bpe' = exact BPE via the optional `gpt-tokenizer` package when installed
  // (exact for OpenAI vocabularies, approximate for llama); falls back to the
  // heuristic if the package is absent.
  COMB_TOKENIZER: z.enum(['heuristic', 'bpe']).default('heuristic'),
  // Model-call resilience: per-request timeout and retry count (network errors,
  // 429, and 5xx are retried with exponential backoff + jitter).
  COMB_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  COMB_HTTP_RETRIES: z.coerce.number().int().min(0).default(2),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('✗ Invalid environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const hasLangbase = Boolean(env.LANGBASE_API_KEY);

// Resolve the backend: explicit wins; `auto` picks langbase-if-keyed, else mock.
const backend: 'mock' | 'langbase' | 'local' =
  env.LLM_BACKEND !== 'auto' ? env.LLM_BACKEND : hasLangbase ? 'langbase' : 'mock';

export const config = {
  port: env.PORT,
  demoUserAccessScope: env.DEMO_USER_ACCESS_SCOPE,

  /** Resolved backend: 'mock' | 'langbase' | 'local'. The factories switch on this. */
  backend,

  langbase: {
    apiKey: env.LANGBASE_API_KEY,
    memoryName: env.LANGBASE_MEMORY_NAME,
    pipeName: env.LANGBASE_PIPE_NAME,
    embeddingModel: env.LANGBASE_EMBEDDING_MODEL,
    generationModel: env.LANGBASE_GENERATION_MODEL,
  },
  ollama: {
    baseUrl: env.OLLAMA_BASE_URL,
    generationModel: env.OLLAMA_GENERATION_MODEL,
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
    embeddingDim: env.EMBEDDING_DIM,
    vectorDatabaseUrl: env.VECTOR_DATABASE_URL ?? env.DATABASE_URL,
    minScore: env.RETRIEVAL_MIN_SCORE,
    keepAlive: env.OLLAMA_KEEP_ALIVE,
  },
  database: {
    url: env.DATABASE_URL,
  },

  /** Recall layer mode (for the banner). */
  memoryMode: backend === 'langbase' ? ('live' as const) : backend === 'local' ? ('local' as const) : ('mock' as const),
  /** Generation layer mode (for the banner). */
  pipeMode: backend === 'langbase' ? ('live' as const) : backend === 'local' ? ('local' as const) : ('mock' as const),

  ingest: {
    apiKey: env.INGEST_API_KEY,
    /** Scopes granted to an API-key-authenticated (e.g. workflow) caller. */
    scopes: env.INGEST_SCOPES.split(',').map((s) => s.trim()).filter(Boolean),
    rateLimitPerMin: env.INGEST_RATE_LIMIT_PER_MIN,
  },
  delivery: {
    kind: env.ACTION_DELIVERY,
    outboxPath: env.ACTION_OUTBOX_PATH,
    webhookUrl: env.ACTION_WEBHOOK_URL,
  },
  comb: {
    /** Root dir for zero-setup file persistence (saved agents, memory, cache). */
    dataDir: env.COMB_DATA_DIR,
    tokenBudgetPerScope: env.COMB_TOKEN_BUDGET_PER_SCOPE,
    cacheTtlSeconds: env.COMB_CACHE_TTL_SECONDS,
    contextWindowTokens: env.COMB_CONTEXT_WINDOW_TOKENS,
    memoryWindowFraction: env.COMB_MEMORY_WINDOW_FRACTION,
    tokenizer: env.COMB_TOKENIZER,
    httpTimeoutMs: env.COMB_HTTP_TIMEOUT_MS,
    httpRetries: env.COMB_HTTP_RETRIES,
    /** Tokens conversation memory may occupy before oldest turns are trimmed. */
    get memoryTokenBudget(): number {
      return Math.floor(env.COMB_CONTEXT_WINDOW_TOKENS * env.COMB_MEMORY_WINDOW_FRACTION);
    },
  },
} as const;

/** Human-readable banner so it's never ambiguous which mode is live. */
export function describeMode(): string {
  return [
    `recall=${config.memoryMode}`,
    `generation=${config.pipeMode}`,
  ].join('  ');
}
