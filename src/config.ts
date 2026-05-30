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
  DATABASE_URL: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
  DEMO_USER_ACCESS_SCOPE: z.string().trim().default('default-team'),
  // Data connector: auto | seed | postgres | csv | json. `auto` picks postgres
  // when DATABASE_URL is set, else seed.
  DATA_CONNECTOR: z.enum(['auto', 'seed', 'postgres', 'csv', 'json']).default('auto'),
  CONNECTOR_PATH: z.string().trim().default(''),
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
const hasPostgres = Boolean(env.DATABASE_URL);

export const config = {
  port: env.PORT,
  demoUserAccessScope: env.DEMO_USER_ACCESS_SCOPE,

  langbase: {
    apiKey: env.LANGBASE_API_KEY,
    memoryName: env.LANGBASE_MEMORY_NAME,
    pipeName: env.LANGBASE_PIPE_NAME,
  },
  database: {
    url: env.DATABASE_URL,
  },

  /** Recall layer: real Langbase Memory when keyed, else in-memory mock. */
  memoryMode: hasLangbase ? ('live' as const) : ('mock' as const),
  /** Generation layer: real Langbase Pipe when keyed, else deterministic mock. */
  pipeMode: hasLangbase ? ('live' as const) : ('mock' as const),
  /** Data source: Postgres when DATABASE_URL set, else in-memory seed data. */
  dataMode: hasPostgres ? ('postgres' as const) : ('seed' as const),

  connector: {
    kind: env.DATA_CONNECTOR,
    path: env.CONNECTOR_PATH,
  },
  delivery: {
    kind: env.ACTION_DELIVERY,
    outboxPath: env.ACTION_OUTBOX_PATH,
    webhookUrl: env.ACTION_WEBHOOK_URL,
  },
} as const;

export type AppConfig = typeof config;

/** Human-readable banner so it's never ambiguous which mode is live. */
export function describeMode(): string {
  return [
    `recall=${config.memoryMode}`,
    `generation=${config.pipeMode}`,
    `data=${config.dataMode}`,
  ].join('  ');
}
