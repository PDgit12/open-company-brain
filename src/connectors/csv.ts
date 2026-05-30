/**
 * CSV connector — ingest a folder of CSV files into a BrainSnapshot.
 *
 * Expects (any subset of) these files in the connector path:
 *   companies.csv  contacts.csv  engagements.csv  programs.csv  company_programs.csv
 *
 * Column headers map to the domain fields (snake_case or camelCase both work).
 * This needs NO external service — point CONNECTOR_PATH at a folder and sync.
 * It is the template every other "structured source" connector follows.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrainSnapshot } from '../domain/types.js';
import type { BrainDataSource } from '../db/datasource.js';

/** Minimal RFC-4180-ish CSV parser: handles quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((c) => c !== '')) rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h] = (r[idx] ?? '').trim()));
    return obj;
  });
}

/** Read a field by snake_case or camelCase header; '' if absent. */
const f = (r: Record<string, string>, ...keys: string[]): string => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== '') return r[k]!;
  return '';
};
const orNull = (v: string): string | null => (v === '' ? null : v);

const DEFAULT_ACCESS = 'default-team';
const nowIso = (): string => new Date().toISOString();

export class CsvConnector implements BrainDataSource {
  constructor(private readonly dir: string) {}

  private async load(file: string): Promise<Array<Record<string, string>>> {
    try {
      return parseCsv(await readFile(path.join(this.dir, file), 'utf8'));
    } catch {
      return []; // a missing file just means that entity is empty
    }
  }

  async loadSnapshot(): Promise<BrainSnapshot> {
    const [companies, contacts, engagements, programs, links] = await Promise.all([
      this.load('companies.csv'),
      this.load('contacts.csv'),
      this.load('engagements.csv'),
      this.load('programs.csv'),
      this.load('company_programs.csv'),
    ]);

    return {
      companies: companies.map((r) => ({
        id: f(r, 'id'),
        name: f(r, 'name'),
        industry: orNull(f(r, 'industry')),
        partnershipTier: orNull(f(r, 'partnership_tier', 'partnershipTier')),
        summary: orNull(f(r, 'summary')),
        access: f(r, 'access') || DEFAULT_ACCESS,
        updatedAt: f(r, 'updated_at', 'updatedAt') || nowIso(),
      })),
      contacts: contacts.map((r) => ({
        id: f(r, 'id'),
        companyId: f(r, 'company_id', 'companyId'),
        name: f(r, 'name'),
        title: orNull(f(r, 'title')),
        email: orNull(f(r, 'email')),
        notes: orNull(f(r, 'notes')),
        access: f(r, 'access') || DEFAULT_ACCESS,
        updatedAt: f(r, 'updated_at', 'updatedAt') || nowIso(),
      })),
      engagements: engagements.map((r) => ({
        id: f(r, 'id'),
        companyId: f(r, 'company_id', 'companyId'),
        kind: f(r, 'kind') || 'note',
        date: (f(r, 'date') || nowIso()).slice(0, 10),
        summary: f(r, 'summary'),
        openActions: orNull(f(r, 'open_actions', 'openActions')),
        access: f(r, 'access') || DEFAULT_ACCESS,
        updatedAt: f(r, 'updated_at', 'updatedAt') || nowIso(),
      })),
      programs: programs.map((r) => ({
        id: f(r, 'id'),
        name: f(r, 'name'),
        description: orNull(f(r, 'description')),
        access: f(r, 'access') || DEFAULT_ACCESS,
        updatedAt: f(r, 'updated_at', 'updatedAt') || nowIso(),
      })),
      companyPrograms: links.map((r) => ({
        companyId: f(r, 'company_id', 'companyId'),
        programId: f(r, 'program_id', 'programId'),
      })),
    };
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
