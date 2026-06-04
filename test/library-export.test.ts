import { describe, it, expect } from 'vitest';
import * as lib from '../src/index.js';
import { Brain, createApp, buildDocuments } from '../src/index.js';

/**
 * The library surface is part of the contract: people embed this in their own
 * stack via `import { Brain } from 'open-company-brain'`. These pin that the
 * headline exports exist and actually work when imported from the package root.
 */
describe('library export surface', () => {
  it('exposes the documented public API', () => {
    for (const name of [
      'Brain',
      'createApp',
      'buildDocuments',
      'normalizeSource',
      'createMemoryStore',
      'ActionService',
      'getCustomAgentStore',
      'config',
    ]) {
      expect(lib, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it('an embedded Brain can ingest and answer from its own data (no server)', async () => {
    const brain = await Brain.create();
    await brain.ingest(
      { format: 'text', source: 'lib-test', content: 'Quasar Labs shipped the v2 indexer in March.' },
      ['default-team'],
    );
    const res = await brain.ask('Quasar Labs v2 indexer', ['default-team']);
    expect(res.sources.some((s) => s.source === 'lib-test')).toBe(true);
  });

  it('buildDocuments is pure and importable from the root', () => {
    const docs = buildDocuments({ format: 'text', content: 'hello world', source: 's', access: 'default-team' });
    expect(docs[0]!.text).toBe('hello world');
    expect(typeof createApp).toBe('function');
  });
});
