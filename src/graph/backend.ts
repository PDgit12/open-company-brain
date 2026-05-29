/**
 * Graph backend abstraction — so the graph can scale beyond memory without
 * changing any caller.
 *
 *   • InMemoryGraphBackend (default, tested) — builds the FK graph from the
 *     snapshot and runs BFS in process. Ideal for pilot-sized data.
 *   • PostgresGraphBackend — runs the SAME traversal as a recursive CTE inside
 *     Postgres, so it scales with the data and needs no new infrastructure.
 *     (Exercised against a live Postgres; the in-memory backend is the default
 *     and is what the test-suite covers.)
 *
 * Beyond this, Apache AGE (openCypher inside Postgres) or Neo4j are drop-in
 * replacements behind the same interface when you need deep traversal or a
 * visual relationship map — see ARCHITECTURE.md.
 */

import pg from 'pg';
import { config } from '../config.js';
import type { BrainSnapshot } from '../domain/types.js';
import {
  buildGraph,
  findIntroPath,
  companyNetwork,
  type CompanyGraph,
  type GraphNode,
  type Path,
} from './relationships.js';

export interface GraphBackend {
  introPath(fromCompanyId: string, toCompanyId: string): Promise<Path | null>;
  network(companyId: string): Promise<GraphNode[]>;
}

export class InMemoryGraphBackend implements GraphBackend {
  private readonly graph: CompanyGraph;
  constructor(snapshot: BrainSnapshot) {
    this.graph = buildGraph(snapshot);
  }
  async introPath(from: string, to: string): Promise<Path | null> {
    return findIntroPath(this.graph, from, to);
  }
  async network(companyId: string): Promise<GraphNode[]> {
    return companyNetwork(this.graph, companyId);
  }
}

export class PostgresGraphBackend implements GraphBackend {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async introPath(from: string, to: string): Promise<Path | null> {
    // Undirected edge list from the foreign keys, then a bounded BFS that tracks
    // the path array and forbids revisiting nodes (cycle guard).
    const sql = `
      WITH RECURSIVE edges AS (
        SELECT 'contact:' || id AS a, 'company:' || company_id AS b FROM contacts
        UNION ALL SELECT 'company:' || company_id, 'contact:' || id FROM contacts
        UNION ALL SELECT 'company:' || company_id, 'program:' || program_id FROM company_programs
        UNION ALL SELECT 'program:' || program_id, 'company:' || company_id FROM company_programs
      ),
      search AS (
        SELECT e.b AS node, ARRAY['company:' || $1::text, e.b] AS path, 1 AS depth
        FROM edges e WHERE e.a = 'company:' || $1::text
        UNION ALL
        SELECT e.b, s.path || e.b, s.depth + 1
        FROM search s JOIN edges e ON e.a = s.node
        WHERE NOT (e.b = ANY(s.path)) AND s.depth < 6
      )
      SELECT path FROM search WHERE node = 'company:' || $2::text ORDER BY depth LIMIT 1`;
    const res = await this.pool.query<{ path: string[] }>(sql, [from, to]);
    const path = res.rows[0]?.path;
    if (!path) return null;
    const nodes = await this.resolveNodes(path);
    return { nodes, description: nodes.map((n) => n.label).join(' → ') };
  }

  async network(companyId: string): Promise<GraphNode[]> {
    const sql = `
      WITH edges AS (
        SELECT 'company:' || company_id AS a, 'contact:' || id AS b, 'contact' AS kind, name AS label FROM contacts
        UNION ALL
        SELECT 'company:' || cp.company_id, 'program:' || p.id, 'program', p.name
        FROM company_programs cp JOIN programs p ON p.id = cp.program_id
      )
      SELECT b AS id, kind, label FROM edges WHERE a = 'company:' || $1::text`;
    const res = await this.pool.query<{ id: string; kind: string; label: string }>(sql, [companyId]);
    return res.rows.map((r) => ({ id: r.id, kind: r.kind as GraphNode['kind'], label: r.label }));
  }

  private async resolveNodes(ids: string[]): Promise<GraphNode[]> {
    const out: GraphNode[] = [];
    for (const id of ids) {
      const [kind, raw] = id.split(':') as [GraphNode['kind'], string];
      const table = kind === 'company' ? 'companies' : kind === 'program' ? 'programs' : 'contacts';
      const r = await this.pool.query<{ name: string }>(`SELECT name FROM ${table} WHERE id = $1`, [raw]);
      out.push({ id, kind, label: r.rows[0]?.name ?? id });
    }
    return out;
  }
}

export function createGraphBackend(snapshot: BrainSnapshot): GraphBackend {
  if (config.dataMode === 'postgres' && config.database.url) {
    return new PostgresGraphBackend(config.database.url);
  }
  return new InMemoryGraphBackend(snapshot);
}
