import { describe, it, expect } from 'vitest';
import { RESET_ALWAYS, RESET_ALL_ONLY } from '../src/harness/reset-targets.js';

/**
 * Regression guard: `comb reset` must wipe the knowledge stores. The model-free
 * keyword store (keyword-docs.json) and file-vector store (vectors.json) once
 * survived reset because the list still named only the legacy brain_chunks.json
 * — a real brain kept stray records. Pin them so a future rename can't re-break it.
 */
describe('reset wipe targets', () => {
  it('always-wipe list includes both knowledge stores', () => {
    expect(RESET_ALWAYS).toContain('keyword-docs.json');
    expect(RESET_ALWAYS).toContain('vectors.json');
  });

  it('saved agents are wiped only on --all, never by default', () => {
    expect(RESET_ALWAYS as readonly string[]).not.toContain('agents.json');
    expect(RESET_ALL_ONLY).toContain('agents.json');
  });
});
