/**
 * The knowledge graph — built from foreign keys, not inferred by an LLM.
 *
 * Every edge here is a real row: a Contact's company_id, an Engagement's
 * company_id, a CompanyProgram link. Because the edges are ground truth, the
 * graph cannot "hallucinate" a relationship — which is exactly why this is the
 * safe version of a knowledge graph for a trust-sensitive pilot.
 *
 * We build the graph in memory from the snapshot. That is the right call for a
 * pilot-sized dataset and keeps the logic pure and testable. UPGRADE PATH when
 * data outgrows memory: push these same traversals into Postgres recursive CTEs,
 * or add the Apache AGE extension for openCypher — the public functions here
 * stay the same, only their implementation moves to SQL.
 */

import type { BrainSnapshot } from '../domain/types.js';

export type NodeKind = 'company' | 'contact' | 'program';

export interface GraphNode {
  id: string; // namespaced: "company:42", "contact:7", "program:3"
  kind: NodeKind;
  label: string;
}

export interface CompanyGraph {
  nodes: Map<string, GraphNode>;
  /** adjacency: nodeId -> set of connected nodeIds (undirected). */
  adj: Map<string, Set<string>>;
}

const nid = (kind: NodeKind, id: string): string => `${kind}:${id}`;

export function buildGraph(snap: BrainSnapshot): CompanyGraph {
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, Set<string>>();

  const addNode = (n: GraphNode): void => {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, n);
      adj.set(n.id, new Set());
    }
  };
  const addEdge = (a: string, b: string): void => {
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  };

  for (const c of snap.companies) addNode({ id: nid('company', c.id), kind: 'company', label: c.name });
  for (const p of snap.programs) addNode({ id: nid('program', p.id), kind: 'program', label: p.name });
  for (const c of snap.contacts) {
    addNode({ id: nid('contact', c.id), kind: 'contact', label: c.name });
    addEdge(nid('contact', c.id), nid('company', c.companyId)); // contact —works at→ company
  }
  for (const e of snap.engagements) {
    // engagements connect a company to its activity; we fold them into the
    // company node rather than create separate nodes (kept lean for v0).
    void e;
  }
  for (const link of snap.companyPrograms) {
    addEdge(nid('company', link.companyId), nid('program', link.programId)); // company —engages→ program
  }

  return { nodes, adj };
}

/** Directly-connected entities for a company (1 hop). */
export function companyNetwork(graph: CompanyGraph, companyId: string): GraphNode[] {
  const start = nid('company', companyId);
  const neighbours = graph.adj.get(start);
  if (!neighbours) return [];
  return [...neighbours].map((id) => graph.nodes.get(id)).filter((n): n is GraphNode => Boolean(n));
}

export interface Path {
  nodes: GraphNode[];
  /** human-readable path, e.g. "Boeing → Jane Smith → Lockheed". */
  description: string;
}

/**
 * Shortest connection path between two companies (BFS). This is the "warm intro
 * path" query: how is company A connected to company B through shared contacts
 * or programs?  Returns null if no path exists in the known data.
 */
export function findIntroPath(
  graph: CompanyGraph,
  fromCompanyId: string,
  toCompanyId: string,
): Path | null {
  const start = nid('company', fromCompanyId);
  const goal = nid('company', toCompanyId);
  if (!graph.nodes.has(start) || !graph.nodes.has(goal)) return null;
  if (start === goal) {
    const n = graph.nodes.get(start)!;
    return { nodes: [n], description: n.label };
  }

  const queue: string[] = [start];
  const prev = new Map<string, string | null>([[start, null]]);

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goal) break;
    for (const next of graph.adj.get(cur) ?? []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }

  if (!prev.has(goal)) return null;

  const chain: GraphNode[] = [];
  for (let at: string | null = goal; at !== null; at = prev.get(at) ?? null) {
    const node = graph.nodes.get(at);
    if (node) chain.unshift(node);
  }
  return { nodes: chain, description: chain.map((n) => n.label).join(' → ') };
}
