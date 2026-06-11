/**
 * The grounding floor — the harness decides refusal, not the model.
 *
 * Vector search never returns "nothing": it returns the nearest neighbours
 * whether or not they're relevant. On the mock (keyword) path an unanswerable
 * query retrieves zero chunks and the refusal works for free; on pgvector the
 * same query pulls the closest 8 documents, and if any clears the global score
 * floor the model is handed plausible noise and answers from it — a fluent,
 * cited, WRONG answer. Cite-or-refuse silently inverts, and only on the path
 * production actually runs.
 *
 * Fix: make "is this grounding sufficient?" a DETERMINISTIC, pre-generation
 * decision in harness code:
 *
 *   • assessGrounding(chunks, policy) — refuse unless the best retrieval score
 *     clears the floor PLUS a thin-grounding margin (barely-over-the-floor noise
 *     is not grounding). The model never sees a context it shouldn't answer from.
 *
 *   • The floor is CALIBRATED PER EMBEDDING MODEL, not hardcoded: different
 *     embedders produce different similarity distributions, so one global 0.5 is
 *     wrong for most of them. `comb calibrate` sweeps a labeled set of
 *     answerable/unanswerable queries and picks the floor that best separates
 *     them; the result is stored per-model and overrides the env default.
 *
 * Policy resolution: mock backend → {floor: 0, margin: 0} (keyword scores are
 * already exact-match-ish; behaviour unchanged). Live backends → calibrated
 * floor (margin 0 — the calibrated boundary IS the decision) when present,
 * else the env floor + a safety margin.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { RetrievedChunk } from './memory.js';

export interface GroundingPolicy {
  /** Minimum best-chunk score for grounding to count. */
  floor: number;
  /** Extra margin above the floor (thin-grounding guard, uncalibrated only). */
  margin: number;
  /** Where the floor came from — surfaced in traces and doctor output. */
  source: 'mock' | 'calibrated' | 'default';
}

export interface GroundingVerdict {
  sufficient: boolean;
  bestScore: number;
  reason: string;
}

/** The deterministic pre-generation gate. Pure — trivially unit-testable. */
export function assessGrounding(chunks: RetrievedChunk[], policy: GroundingPolicy): GroundingVerdict {
  if (chunks.length === 0) {
    return { sufficient: false, bestScore: 0, reason: 'no records retrieved' };
  }
  const bestScore = Math.max(...chunks.map((c) => c.score));
  const bar = policy.floor + policy.margin;
  if (bestScore < bar) {
    return {
      sufficient: false,
      bestScore,
      reason: `best score ${bestScore.toFixed(3)} below grounding bar ${bar.toFixed(3)} (${policy.source})`,
    };
  }
  return { sufficient: true, bestScore, reason: 'grounded' };
}

// ─── Calibration: pick the floor from labeled queries ────────────────────────

export interface LabeledQuery {
  query: string;
  /** true = the brain SHOULD answer this; false = it should refuse. */
  answerable: boolean;
}

export interface CalibrationPoint {
  query: string;
  answerable: boolean;
  bestScore: number;
}

export interface CalibrationResult {
  floor: number;
  /** Fraction of answerable queries that still ground at this floor. */
  answerableRecall: number;
  /** Fraction of unanswerable queries correctly refused at this floor. */
  unanswerableRefusal: number;
}

/**
 * Pick the floor that best separates answerable from unanswerable (maximize
 * recall + refusal). Candidate floors are the MIDPOINTS between adjacent
 * observed scores (plus 0 and just-above-max) — not a fixed grid — so even a
 * hairline gap between the two distributions yields a floor inside it. Ties
 * resolve to the middle candidate of the best plateau.
 */
export function chooseFloor(points: CalibrationPoint[]): CalibrationResult {
  const answerable = points.filter((p) => p.answerable);
  const unanswerable = points.filter((p) => !p.answerable);
  const evaluate = (floor: number): CalibrationResult => ({
    floor: Number(floor.toFixed(4)),
    answerableRecall: answerable.length
      ? answerable.filter((p) => p.bestScore >= floor).length / answerable.length
      : 1,
    unanswerableRefusal: unanswerable.length
      ? unanswerable.filter((p) => p.bestScore < floor).length / unanswerable.length
      : 1,
  });

  // Candidates: 0, every midpoint between adjacent distinct scores, and just
  // above the max (the "refuse everything" end of the sweep).
  const scores = [...new Set(points.map((p) => p.bestScore))].sort((a, b) => a - b);
  const candidates = [0];
  for (let i = 0; i + 1 < scores.length; i++) candidates.push((scores[i]! + scores[i + 1]!) / 2);
  if (scores.length) candidates.push(scores[scores.length - 1]! + 0.001);

  let best: CalibrationResult[] = [evaluate(candidates[0]!)];
  for (const c of candidates.slice(1)) {
    const r = evaluate(c);
    const bestSum = best[0]!.answerableRecall + best[0]!.unanswerableRefusal;
    const sum = r.answerableRecall + r.unanswerableRefusal;
    if (sum > bestSum) best = [r];
    else if (sum === bestSum) best.push(r);
  }
  return best[Math.floor(best.length / 2)]!;
}

// ─── Per-model calibration store (data-dir JSON) ─────────────────────────────

export interface StoredCalibration {
  floor: number;
  answerableRecall: number;
  unanswerableRefusal: number;
  samples: number;
  calibratedAt: string;
}

type CalibrationFile = Record<string, StoredCalibration>;

const calibrationPath = (dataDir: string): string => path.join(dataDir, 'calibration.json');

export async function loadCalibrations(dataDir: string): Promise<CalibrationFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(calibrationPath(dataDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as CalibrationFile) : {};
  } catch {
    return {};
  }
}

export async function saveCalibration(
  dataDir: string,
  model: string,
  entry: StoredCalibration,
): Promise<void> {
  const all = await loadCalibrations(dataDir);
  all[model] = entry;
  await mkdir(dataDir, { recursive: true });
  await writeFile(calibrationPath(dataDir), JSON.stringify(all, null, 2) + '\n', 'utf8');
}

/** The embedding-model key calibration is stored under for the active backend. */
export function activeEmbeddingModel(): string {
  if (config.backend === 'local') return config.ollama.embeddingModel;
  if (config.backend === 'langbase') return config.langbase.embeddingModel;
  return 'mock';
}

/** Resolve the grounding policy for the active backend (calibration-aware). */
export async function resolveGroundingPolicy(dataDir = config.comb.dataDir): Promise<GroundingPolicy> {
  if (config.backend === 'mock') return { floor: 0, margin: 0, source: 'mock' };
  const calibrated = (await loadCalibrations(dataDir))[activeEmbeddingModel()];
  if (calibrated) return { floor: calibrated.floor, margin: 0, source: 'calibrated' };
  return { floor: config.ollama.minScore, margin: config.comb.groundingMargin, source: 'default' };
}
