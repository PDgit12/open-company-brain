import { describe, it, expect } from 'vitest';
import { deriveThemes } from '../src/brain/enrichment.js';
import { companyToDocument } from '../src/brain/documents.js';
import { META_THEMES } from '../src/constants.js';
import { SEED_SNAPSHOT } from '../src/seed/seed-data.js';

describe('relation-enrichment', () => {
  it('derives themes from text deterministically', () => {
    const themes = deriveThemes('Exploring an ML research lab and sponsorship renewal');
    expect(themes).toContain('ml-research');
    expect(themes).toContain('research');
    expect(themes).toContain('sponsorship');
  });

  it('is order-independent and de-duplicated', () => {
    expect(deriveThemes('research', 'research again')).toEqual(['research']);
  });

  it('stamps derived themes onto the company document metadata', () => {
    const company = SEED_SNAPSHOT.companies[0]!; // Aerodyne — ML research
    const doc = companyToDocument(company, SEED_SNAPSHOT.contacts, SEED_SNAPSHOT.engagements);
    expect(doc.metadata[META_THEMES]).toContain('ml-research');
    expect(doc.text).toContain('Themes:');
  });
});
