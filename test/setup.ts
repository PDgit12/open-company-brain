/**
 * Test setup — force MOCK mode regardless of any local .env.
 *
 * Tests must be deterministic and offline. We clear the credentials BEFORE the
 * app config is imported; dotenv does not override already-set env vars, so this
 * pins recall/generation/data to their mock implementations.
 */
process.env.LANGBASE_API_KEY = '';
process.env.DATABASE_URL = '';
