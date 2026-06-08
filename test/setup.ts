/**
 * Test setup — force MOCK mode regardless of any local .env.
 *
 * Tests must be deterministic and offline. We clear the credentials BEFORE the
 * app config is imported; dotenv does not override already-set env vars, so this
 * pins recall/generation/data to their mock implementations.
 */
process.env.LANGBASE_API_KEY = '';
process.env.DATABASE_URL = '';
process.env.VECTOR_DATABASE_URL = '';
process.env.LLM_BACKEND = 'mock';
// Leave the write path open by default so the keyless ingest tests stay 200.
// The auth-enabled path is tested in isolation (ingest-auth.test.ts) with
// vi.resetModules + a fresh config import.
process.env.INGEST_API_KEY = '';
// Point zero-setup file persistence at a throwaway temp dir so tests that hit
// the file-backed stores never write into the repo. Suites that assert on the
// file layout create their own temp dirs; this only catches incidental writes.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.COMB_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'comb-test-'));
