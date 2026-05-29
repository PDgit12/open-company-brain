import { describe, it, expect } from 'vitest';
import { buildGraph, findIntroPath, companyNetwork } from '../src/graph/relationships.js';
import { SEED_SNAPSHOT } from '../src/seed/seed-data.js';

describe('knowledge graph (from foreign keys)', () => {
  const graph = buildGraph(SEED_SNAPSHOT);

  it('builds nodes for companies, contacts and programs', () => {
    expect(graph.nodes.size).toBe(
      SEED_SNAPSHOT.companies.length +
        SEED_SNAPSHOT.contacts.length +
        SEED_SNAPSHOT.programs.length,
    );
  });

  it('connects a company to its directly-related entities', () => {
    const net = companyNetwork(graph, '1'); // Aerodyne Systems
    expect(net.length).toBeGreaterThan(0);
    expect(net.some((n) => n.kind === 'contact')).toBe(true);
  });

  it('finds a warm-intro path between two companies via a shared program', () => {
    // Aerodyne (1) and Veridian (4) both engage the ML Research Initiative (3),
    // so the graph connects them: Aerodyne → ML Research Initiative → Veridian.
    const path = findIntroPath(graph, '1', '4');
    expect(path).not.toBeNull();
    expect(path!.nodes.length).toBeGreaterThanOrEqual(2);
    expect(path!.description).toContain('Aerodyne Systems');
    expect(path!.description).toContain('Veridian Energy');
  });

  it('returns null when no connection path exists', () => {
    const isolatedSnap = {
      ...SEED_SNAPSHOT,
      contacts: [],
      companyPrograms: [],
    };
    const g = buildGraph(isolatedSnap);
    expect(findIntroPath(g, '1', '4')).toBeNull();
  });
});
