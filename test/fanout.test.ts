import { describe, it, expect, beforeEach } from 'vitest';
import { Brain } from '../src/brain/brain.js';
import { getReactionAgentStore, resetReactionAgentStore } from '../src/fanout/registry.js';
import { getFanoutResultStore, resetFanoutResultStore } from '../src/fanout/engine.js';

beforeEach(() => {
  // Each test starts from an empty registry + results (process-singleton reset).
  resetReactionAgentStore();
  resetFanoutResultStore();
});

describe('fan-out engine', () => {
  it('does NOTHING when no reaction agents are configured (cost guard)', async () => {
    const brain = await Brain.create();
    const r = await brain.ingest(
      { format: 'text', source: 'feed', content: 'Acme signed a pilot for Q3.' },
      ['default-team'],
    );
    expect(r.ingested).toBe(1);
    expect(r.reactions).toHaveLength(0);
  });

  it('runs a configured reaction agent automatically on ingest, grounded + cited', async () => {
    await getReactionAgentStore().save({
      name: 'Summarizer',
      instruction: 'Summarize the new note in one line.',
    });
    const brain = await Brain.create();
    const r = await brain.ingest(
      { format: 'text', source: 'feed', content: 'Project Atlas migration plan is due Friday.' },
      ['default-team'],
    );
    expect(r.reactions).toHaveLength(1);
    expect(r.reactions[0]!.agentName).toBe('Summarizer');
    expect(r.reactions[0]!.sources.length).toBeGreaterThan(0); // grounded on the new data
    expect(r.reactions[0]!.scope).toBe('default-team');

    // The result is queryable from the store, scope-gated.
    const visible = await getFanoutResultStore().list(['default-team']);
    expect(visible).toHaveLength(1);
    const hidden = await getFanoutResultStore().list(['other-team']);
    expect(hidden).toHaveLength(0);
  });

  it('a scoped reaction agent only fires on ingests in its own scope', async () => {
    await getReactionAgentStore().save({
      name: 'Leadership watch',
      instruction: 'Flag anything sensitive.',
      scope: 'leadership',
    });
    const brain = await Brain.create();

    const defaultIngest = await brain.ingest(
      { format: 'text', source: 'feed', content: 'Routine standup notes.' },
      ['default-team'],
    );
    expect(defaultIngest.reactions).toHaveLength(0); // wrong scope — did not fire

    const leadershipIngest = await brain.ingest(
      { format: 'text', source: 'board', content: 'Confidential acquisition figures enclosed.' },
      ['leadership'],
    );
    expect(leadershipIngest.reactions).toHaveLength(1);
    expect(leadershipIngest.reactions[0]!.scope).toBe('leadership');
  });
});
