/**
 * Judge calibration (MTR-184) — pure, no `server-only`, so both the DB-backed
 * calibration script and the drift-fixture eval share ONE implementation with
 * the harness's rubric (critique-core).
 *
 * Two questions this answers:
 *
 *  1. Does the VLM judge agree with humans? `correlateJudgeVsHuman` correlates
 *     each aesthetic dimension (and the aggregate) against the owner's 👍/👎
 *     rating. A weak or negative correlation on a dimension is a signal to
 *     rewrite that rubric line in critique-core.ts — before the visually-weak
 *     repair loop burns money making parts worse by human lights.
 *
 *  2. Has the judge drifted? `driftCheck` compares live judge scores on a
 *     frozen fixture set against hand-assigned baselines and fails when the
 *     gap exceeds a threshold — insurance for a model upgrade on the `critique`
 *     role.
 */
import { AESTHETIC_DIMENSIONS } from "./critique-core";

/** One scored generation row (from cadGenerations) reduced to what calibration needs. */
export interface CalibrationSample {
  /** Owner rating; only "good"/"bad" rows are usable (null = unrated). */
  rating: string | null;
  /** VLM aggregate 0-100 (null when the judge was off/unavailable). */
  aestheticScore?: number | null;
  /** Per-dimension judge scores, shape `{ [dim]: { score } }` (0-5). */
  aestheticDims?: Record<string, { score?: number } | null> | null;
  /** Judge model that produced the scores (configFingerprint.models.critique). */
  judgeModel?: string | null;
}

/** Correlation of one continuous metric against the binary human rating. */
export interface MetricCorrelation {
  metric: string;
  /** Rows where both the metric and a good/bad rating were present. */
  n: number;
  /** Point-biserial (= Pearson vs 0/1 rating) in [-1, 1]; null if degenerate. */
  correlation: number | null;
  /** Mean metric value on 👍 rows / 👎 rows (null when that side is empty). */
  meanWhenGood: number | null;
  meanWhenBad: number | null;
}

export interface CalibrationReport {
  /** Rows with a usable good/bad rating. */
  ratedRows: number;
  goodRows: number;
  badRows: number;
  /** aestheticScore (0-100) vs rating. */
  aggregate: MetricCorrelation;
  /** Per aesthetic dimension (0-5) vs rating. */
  perDimension: MetricCorrelation[];
  /** Populated when the samples were sliced to one judge model. */
  judgeModel?: string | null;
}

/**
 * Pearson correlation of xs vs ys. Returns null when n < 2 or either series has
 * zero variance (a straight line has no defined slope). Point-biserial is just
 * Pearson with a dichotomous ys, so this covers the rating case directly.
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

function ratingToBinary(rating: string | null): 0 | 1 | null {
  if (rating === "good") return 1;
  if (rating === "bad") return 0;
  return null; // unrated or unknown — not usable
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Correlate one metric extractor against the human rating over the samples. */
function correlateMetric(
  metric: string,
  samples: CalibrationSample[],
  extract: (s: CalibrationSample) => number | null | undefined
): MetricCorrelation {
  const xs: number[] = [];
  const ys: number[] = [];
  const good: number[] = [];
  const bad: number[] = [];
  for (const s of samples) {
    const y = ratingToBinary(s.rating);
    if (y == null) continue;
    const x = extract(s);
    if (x == null || !Number.isFinite(x)) continue;
    xs.push(x);
    ys.push(y);
    (y === 1 ? good : bad).push(x);
  }
  return {
    metric,
    n: xs.length,
    correlation: pearson(xs, ys),
    meanWhenGood: mean(good),
    meanWhenBad: mean(bad),
  };
}

/**
 * Full calibration report over a set of scored+rated generations. Rows without
 * a good/bad rating are ignored; per-metric `n` reflects only rows that also
 * carried that metric, so a dimension present on fewer rows is honestly counted.
 */
export function correlateJudgeVsHuman(
  samples: CalibrationSample[]
): CalibrationReport {
  const rated = samples.filter((s) => ratingToBinary(s.rating) != null);
  const good = rated.filter((s) => s.rating === "good").length;
  return {
    ratedRows: rated.length,
    goodRows: good,
    badRows: rated.length - good,
    aggregate: correlateMetric("aggregate", samples, (s) => s.aestheticScore),
    perDimension: AESTHETIC_DIMENSIONS.map((dim) =>
      correlateMetric(dim, samples, (s) => s.aestheticDims?.[dim]?.score)
    ),
  };
}

// ── Drift fixtures ─────────────────────────────────────────────────────────

/** Hand-assigned baseline for a frozen fixture render. */
export interface FixtureBaseline {
  id: string;
  /** Hand-assigned aggregate 0-100. */
  aggregate?: number;
  /** Hand-assigned per-dimension 0-5. */
  dims?: Record<string, number>;
}

/** A live judge scoring of the same fixture. */
export interface FixtureLive {
  id: string;
  aggregate?: number;
  dims?: Record<string, number>;
}

export interface FixtureDrift {
  id: string;
  /** |live - baseline| on the aggregate (0-100), null when either is missing. */
  aggregateDrift: number | null;
  /** |live - baseline| per dimension (0-5). */
  dimDrift: Record<string, number>;
  /** True when the live scoring is within tolerance (or the fixture had no live score → fail). */
  pass: boolean;
  /** Why it failed, for the runner's output. */
  reasons: string[];
}

export interface DriftReport {
  pass: boolean;
  results: FixtureDrift[];
  aggregateTol: number;
  dimTol: number;
}

export interface DriftOptions {
  /** Max allowed aggregate gap in points (0-100). */
  aggregateTol?: number;
  /** Max allowed per-dimension gap (0-5). */
  dimTol?: number;
}

/**
 * Compare live judge scores against hand-assigned baselines. Fails a fixture
 * when the aggregate gap exceeds `aggregateTol` OR any dimension gap exceeds
 * `dimTol`, and fails a fixture that has no live score at all (a judge that
 * stopped scoring is drift too). An intentionally perturbed rubric shifts the
 * live scores and trips this — the MTR-184 acceptance.
 */
export function driftCheck(
  baselines: FixtureBaseline[],
  live: FixtureLive[],
  opts: DriftOptions = {}
): DriftReport {
  const aggregateTol = opts.aggregateTol ?? 8;
  const dimTol = opts.dimTol ?? 1;
  const liveById = new Map(live.map((l) => [l.id, l]));

  const results: FixtureDrift[] = baselines.map((base) => {
    const l = liveById.get(base.id);
    const reasons: string[] = [];
    if (!l) {
      return {
        id: base.id,
        aggregateDrift: null,
        dimDrift: {},
        pass: false,
        reasons: ["no live score for fixture (judge produced nothing)"],
      };
    }
    let aggregateDrift: number | null = null;
    if (base.aggregate != null && l.aggregate != null) {
      aggregateDrift = Math.abs(l.aggregate - base.aggregate);
      if (aggregateDrift > aggregateTol) {
        reasons.push(
          `aggregate drifted ${aggregateDrift.toFixed(1)} pts (>${aggregateTol})`
        );
      }
    }
    const dimDrift: Record<string, number> = {};
    for (const [dim, baseScore] of Object.entries(base.dims ?? {})) {
      const liveScore = l.dims?.[dim];
      if (liveScore == null) {
        reasons.push(`dimension ${dim} missing in live scoring`);
        continue;
      }
      const d = Math.abs(liveScore - baseScore);
      dimDrift[dim] = d;
      if (d > dimTol) reasons.push(`${dim} drifted ${d.toFixed(1)} (>${dimTol})`);
    }
    return { id: base.id, aggregateDrift, dimDrift, pass: reasons.length === 0, reasons };
  });

  return {
    pass: results.every((r) => r.pass),
    results,
    aggregateTol,
    dimTol,
  };
}
