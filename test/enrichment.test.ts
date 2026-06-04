import { describe, it, expect } from 'vitest';
import { deriveThemes } from '../src/brain/enrichment.js';
import { buildDocuments } from '../src/brain/ingest.js';
import { META_THEMES } from '../src/constants.js';

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

  it('stamps derived themes onto ingested document metadata', () => {
    const docs = buildDocuments({
      format: 'text',
      content: 'Kicked off a machine learning research collaboration.',
      source: 'notes',
      access: 'default-team',
    });
    expect(docs[0]!.metadata[META_THEMES]).toContain('ml-research');
    expect(docs[0]!.metadata[META_THEMES]).toContain('research');
  });
});
