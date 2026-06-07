import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain/brain.js';
import { ToolFabric, BuiltinToolSource, type ToolSource, type ToolSpec } from '../src/tools/fabric.js';

/** A fake external source (stands in for a connected MCP server). */
class FakeSource implements ToolSource {
  readonly namespace = 'knit';
  async list(): Promise<ToolSpec[]> {
    return [
      {
        id: 'knit.search', namespace: 'knit', name: 'search',
        description: 'search learnings', inputSchema: { type: 'object' },
        call: async (args) => `knit got: ${JSON.stringify(args)}`,
      },
    ];
  }
  async close(): Promise<void> {}
}

describe('Tool Fabric', () => {
  it('merges kernel built-ins with external sources, namespaced', async () => {
    const brain = await Brain.create();
    const fabric = new ToolFabric([new BuiltinToolSource(brain), new FakeSource()]);
    await fabric.refresh();
    const ids = fabric.list().map((t) => t.id);
    expect(ids).toContain('brain.search');
    expect(ids).toContain('brain.ingest');
    expect(ids).toContain('knit.search'); // namespacing prevents collision with brain.search
    await fabric.close();
  });

  it('routes a call to the right source and threads scopes to kernel tools', async () => {
    const brain = await Brain.create();
    const fabric = new ToolFabric([new BuiltinToolSource(brain)]);
    await fabric.refresh();
    // brain.search over the demo seed (mock backend) finds grounded records.
    const out = await fabric.call('brain.search', { query: 'Project Atlas migration' }, ['default-team']);
    expect(out).toContain('Atlas');
    // scope isolation holds through the fabric.
    const denied = await fabric.call('brain.search', { query: 'Project Atlas migration' }, ['nobody']);
    expect(denied).toMatch(/no matching records/i);
  });

  it('throws on an unknown tool id', async () => {
    const fabric = new ToolFabric([new FakeSource()]);
    await fabric.refresh();
    await expect(fabric.call('nope.nope', {}, [])).rejects.toThrow(/unknown tool/i);
  });
});
