import { describe, it, expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assessGrounding,
  chooseFloor,
  loadCalibrations,
  saveCalibration,
  resolveGroundingPolicy,
  type CalibrationPoint,
  type GroundingPolicy,
} from '../src/brain/grounding.js';
import { Brain } from '../src/brain/brain.js';
import { NO_CONTEXT_REPLY } from '../src/agents/generator.js';
import type { RetrievedChunk } from '../src/brain/memory.js';

const tempDir = (): Promise<string> => mkdtemp(path.join(tmpdir(), 'comb-grounding-'));
const chunk = (score: number): RetrievedChunk => ({ text: 'x', source: 's', metadata: {}, score });
const policy = (floor: number, margin: number): GroundingPolicy => ({ floor, margin, source: 'default' });

describe('assessGrounding — the deterministic pre-generation gate', () => {
  it('refuses on zero retrieval', () => {
    const v = assessGrounding([], policy(0.5, 0.05));
    expect(v.sufficient).toBe(false);
    expect(v.reason).toContain('no records');
  });

  it('refuses thin grounding: best score barely over the floor is noise', () => {
    // The Foobar failure mode: nearest-neighbour chunks just past the floor.
    const v = assessGrounding([chunk(0.52), chunk(0.51)], policy(0.5, 0.05));
    expect(v.sufficient).toBe(false);
    expect(v.bestScore).toBe(0.52);
  });

  it('grounds when the best score clears floor + margin', () => {
    expect(assessGrounding([chunk(0.7), chunk(0.4)], policy(0.5, 0.05)).sufficient).toBe(true);
  });

  it('mock policy (floor 0, margin 0) only refuses on empty — keyword behaviour unchanged', () => {
    expect(assessGrounding([chunk(0.01)], policy(0, 0)).sufficient).toBe(true);
    expect(assessGrounding([], policy(0, 0)).sufficient).toBe(false);
  });
});

describe('chooseFloor — calibration from labeled queries', () => {
  it('places the floor between separable distributions (plateau midpoint)', () => {
    const points: CalibrationPoint[] = [
      { query: 'a1', answerable: true, bestScore: 0.78 },
      { query: 'a2', answerable: true, bestScore: 0.72 },
      { query: 'a3', answerable: true, bestScore: 0.81 },
      { query: 'u1', answerable: false, bestScore: 0.55 },
      { query: 'u2', answerable: false, bestScore: 0.51 },
      { query: 'u3', answerable: false, bestScore: 0.58 },
    ];
    const r = chooseFloor(points);
    expect(r.answerableRecall).toBe(1);
    expect(r.unanswerableRefusal).toBe(1);
    expect(r.floor).toBeGreaterThan(0.58);
    expect(r.floor).toBeLessThanOrEqual(0.72);
  });

  it('trades off when distributions overlap instead of failing', () => {
    const points: CalibrationPoint[] = [
      { query: 'a1', answerable: true, bestScore: 0.6 },
      { query: 'a2', answerable: true, bestScore: 0.5 },
      { query: 'u1', answerable: false, bestScore: 0.55 },
      { query: 'u2', answerable: false, bestScore: 0.3 },
    ];
    const r = chooseFloor(points);
    expect(r.answerableRecall + r.unanswerableRefusal).toBeGreaterThan(1); // better than chance
  });
});

describe('calibration store + policy resolution', () => {
  it('saves and reloads a per-model calibration', async () => {
    const dir = await tempDir();
    await saveCalibration(dir, 'nomic-embed-text', {
      floor: 0.62, answerableRecall: 1, unanswerableRefusal: 1, samples: 8, calibratedAt: new Date().toISOString(),
    });
    const all = await loadCalibrations(dir);
    expect(all['nomic-embed-text']!.floor).toBe(0.62);
  });

  it('resolves the mock policy as floor 0 / margin 0 (tests stay hermetic)', async () => {
    const p = await resolveGroundingPolicy(await tempDir());
    expect(p).toEqual({ floor: 0, margin: 0, source: 'mock' });
  });
});

describe('Brain — refusal is decided in code, with no sources', () => {
  it('refuses an unanswerable query with EMPTY sources (no citing what we refused to use)', async () => {
    const brain = await Brain.create();
    const r = await brain.ask('What is our history with Foobar Industries?', ['default-team']);
    expect(r.answer).toContain(NO_CONTEXT_REPLY);
    expect(r.sources).toEqual([]);
  });

  it('draft inherits the gate: unanswerable draft refuses with no sources', async () => {
    const brain = await Brain.create();
    const r = await brain.draft('Foobar Industries contract history', 'Summarize it.', ['default-team']);
    expect(r.text).toContain(NO_CONTEXT_REPLY);
    expect(r.sources).toEqual([]);
  });

  it('still answers a grounded query with sources', async () => {
    const brain = await Brain.create();
    const r = await brain.ask('Project Atlas migration plan', ['default-team']);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.answer).not.toContain(NO_CONTEXT_REPLY);
  });
});
