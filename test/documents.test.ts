import { describe, it, expect } from 'vitest';
import { snapshotToDocuments, companyToDocument } from '../src/brain/documents.js';
import { META_ACCESS, META_KIND, META_COMPANY } from '../src/constants.js';
import { SEED_SNAPSHOT } from '../src/seed/seed-data.js';

describe('document templating', () => {
  it('renders every company, contact and engagement into a document', () => {
    const docs = snapshotToDocuments(SEED_SNAPSHOT);
    const expected =
      SEED_SNAPSHOT.companies.length +
      SEED_SNAPSHOT.contacts.length +
      SEED_SNAPSHOT.engagements.length;
    expect(docs).toHaveLength(expected);
  });

  it('stamps every document with the access scope (the governance seam)', () => {
    const docs = snapshotToDocuments(SEED_SNAPSHOT);
    for (const d of docs) {
      expect(d.metadata[META_ACCESS]).toBeTruthy();
    }
  });

  it('embeds a company name and recent engagements into the company document', () => {
    const company = SEED_SNAPSHOT.companies[0]!;
    const doc = companyToDocument(company, SEED_SNAPSHOT.contacts, SEED_SNAPSHOT.engagements);
    expect(doc.text).toContain(company.name);
    expect(doc.metadata[META_KIND]).toBe('company');
    expect(doc.metadata[META_COMPANY]).toBe(company.name);
    expect(doc.id).toBe(`company:${company.id}`);
  });

  it('is pure — same input yields identical output', () => {
    const a = snapshotToDocuments(SEED_SNAPSHOT);
    const b = snapshotToDocuments(SEED_SNAPSHOT);
    expect(a).toEqual(b);
  });
});
