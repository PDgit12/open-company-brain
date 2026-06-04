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
  LANGBASE_MEMORY_NAME: z.string().trim().default('company-brain'),
  LANGBASE_PIPE_NAME: z.string().trim().default('company-brain-agent'),
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
} as const;

/** Human-readable banner so it's never ambiguous which mode is live. */
export function describeMode(): string {
  return [
    `recall=${config.memoryMode}`,
    `generation=${config.pipeMode}`,
  ].join('  ');
}
