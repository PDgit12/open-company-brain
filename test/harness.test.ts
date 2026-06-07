import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';
import { createFabric } from '../src/tools/assemble.js';
import { BuiltinAgent, toOllamaTools, sanitizeName } from '../src/harness/agent.js';
import { pickAgent } from '../src/harness/run.js';

describe('harness — agent adapter', () => {
  it('BuiltinAgent runs a grounded, cited answer on the kernel', async () => {
    const brain = await Brain.create();
    const fabric = await createFabric(brain, { servers: [] });
    const r = await new BuiltinAgent().run('Project Atlas migration plan', { brain, fabric, scopes: ['default-team'] });
    expect(r.output).toContain('Atlas');
    expect(r.output).toMatch(/Sources:/);
    await fabric.close();
  });

  it('pickAgent("builtin") is backend-agnostic; auto falls back to builtin off local', () => {
    expect(pickAgent('builtin').name).toBe('builtin');
    expect(pickAgent('auto').name).toBe('builtin'); // tests run on the mock backend
  });

  it('toOllamaTools sanitizes dotted ids and keeps a name→id map', async () => {
    const brain = await Brain.create();
    const fabric = await createFabric(brain, { servers: [] });
    const { tools, byName } = toOllamaTools(fabric.list());
    const search = tools.find((t) => t.function.name === 'brain__search');
    expect(search).toBeTruthy();
    expect(byName.get('brain__search')).toBe('brain.search');
    expect(sanitizeName('knit.search_learnings')).toBe('knit__search_learnings');
    await fabric.close();
  });
});
