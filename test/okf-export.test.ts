import { describe, it, expect } from 'vitest';
import { toOkfBundle } from '../src/harness/okf-export.js';
import type { MemoryDocument } from '../src/brain/documents.js';

const doc = (id: string, text: string, access: string, source: string, extra: Record<string, string> = {}): MemoryDocument => ({
  id,
  text,
  metadata: { access, source, ...extra },
});

describe('OKF export', () => {
  it('emits one scope-gated OKF concept file per source with frontmatter', () => {
    const docs = [
      doc('handbook:1', 'PTO minimum is 15 days.', 'default-team', 'handbook', { kind: 'policy', themes: 'hr,pto' }),
      doc('handbook:2', 'Core hours 9-1 Pacific.', 'default-team', 'handbook', { kind: 'policy' }),
      doc('secret:1', 'leadership only', 'leadership', 'board-notes'),
    ];
    const files = toOkfBundle(docs, ['default-team']);

    expect(files).toHaveLength(1); // leadership source excluded by scope
    const f = files[0]!;
    expect(f.filename).toBe('handbook.md');
    expect(f.content).toContain('type: policy'); // kind → OKF type
    expect(f.content).toContain('title: handbook');
    expect(f.content).toContain('tags: hr,pto'); // themes → OKF tags
    expect(f.content).toContain('PTO minimum is 15 days.');
    expect(f.content).toContain('Core hours 9-1 Pacific.'); // same-source grouped
  });

  it('defaults type to concept and omits tags when absent', () => {
    const files = toOkfBundle([doc('notes:1', 'hi', 'default-team', 'notes')], ['default-team']);
    expect(files[0]!.content).toContain('type: concept');
    expect(files[0]!.content).not.toContain('tags:');
  });
});
