import { describe, it, expect } from 'vitest';
import { MockEmbedder, cosineSim } from '../src/brain/embedding.js';

describe('embedding layer', () => {
  it('cosineSim: identical vectors = 1, orthogonal = 0', () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    expect(cosineSim([0, 0], [0, 0])).toBe(0); // zero vector is safe, not NaN
  });

  it('MockEmbedder is deterministic and unit-normalized', async () => {
    const e = new MockEmbedder(64);
    const [a1] = await e.embed(['Aerodyne renewal status']);
    const [a2] = await e.embed(['Aerodyne renewal status']);
    expect(a1).toEqual(a2);
    expect(a1!.length).toBe(64);
    const norm = Math.sqrt(a1!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1);
  });

  it('similar text scores higher than unrelated text', async () => {
    const e = new MockEmbedder(128);
    const [q] = await e.embed(['Aerodyne partnership renewal']);
    const [near] = await e.embed(['Aerodyne renewal call next year']);
    const [far] = await e.embed(['weather forecast tomorrow sunny']);
    expect(cosineSim(q!, near!)).toBeGreaterThan(cosineSim(q!, far!));
  });
});
