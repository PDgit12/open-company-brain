/**
 * File-tier state wiped by `comb reset`. Extracted from the CLI (which
 * self-executes on import, so it can't be unit-tested) into a pure, tested
 * module — a renamed knowledge store silently surviving reset is a data-leak
 * regression (it happened: the model-free store moved to keyword-docs.json but
 * reset still only deleted the legacy brain_chunks.json).
 */

/** Always wiped: knowledge stores + closed-loop state. Saved agents kept. */
export const RESET_ALWAYS = [
  // Knowledge stores — the ACTUAL data a real brain holds. Must be here.
  'keyword-docs.json', // model-free keyword store (FileKeywordMemoryStore)
  'vectors.json', // file-backed vector store (FileVectorMemoryStore)
  'brain_chunks.json', // legacy knowledge file
  // Closed-loop / history state.
  'divergences.json',
  'runs.json',
  'intents.json',
  'conversations.json',
  'actions.json',
  'action-audit.json',
] as const;

/** Additionally wiped only on `--all`: agents, calibration, budgets, caches. */
export const RESET_ALL_ONLY = [
  'agents.json',
  'calibration.json',
  'token-usage.json',
  'response-cache.json',
  'birthkits',
] as const;
