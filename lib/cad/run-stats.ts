import type { CadEngineId } from "./engines/types";
import { classifyKernelError } from "./repair-taxonomy";
import type { CadDfmReport, CadRunResult, CadUsageSummary } from "./types";

/**
 * Per-generation outcome record (`cadGenerations.runStats`).
 *
 * The engine bake-off needs one row per generation answering: which engine,
 * did it work, what KIND of failure, how many retries, how much time went to
 * the model versus to geometry, how big was the mesh, was it closed. Those
 * signals existed but were scattered — some on the generation row, some
 * inside cadJobs.usage, some only in the transient run payload and never
 * persisted at all (triangle count and watertightness among them). Querying
 * "which engine wins" meant joining three shapes and giving up on two.
 *
 * Deliberately a single jsonb blob rather than seven columns: this is
 * comparison instrumentation with a scheduled end, and it should be
 * droppable in one migration when the losing engine goes.
 *
 * PURE — no db, no env, no server-only — so the benchmark and tests can build
 * and assert these without infrastructure.
 */
export interface CadRunStats {
  v: 1;
  engine: CadEngineId;
  ok: boolean;
  /** Repair turns spent (mirrors cadGenerations.attempts). */
  attempts: number;
  /** Kernel failure class from the taxonomy; null when ok or unclassifiable. */
  failureClass: string | null;
  /** Wall time inside model calls (ms). */
  modelMs: number;
  /** Wall time inside sidecar geometry execution (ms). */
  geometryMs: number;
  triangles: number | null;
  watertight: boolean | null;
  manifold: boolean | null;
  /** Connected bodies in the exported mesh; >1 means debris. */
  bodyCount: number | null;
  /** The printable mesh came from the lossy voxel remesh fallback. */
  remeshed: boolean;
  /**
   * Printability summary. `ok: null` means the probes did not RUN — unknown,
   * never a pass (see CadDfmReport). Flattened to the few fields a scorecard
   * aggregates; the full report stays in the run payload.
   */
  dfm: {
    ok: boolean | null;
    probesRan: boolean | null;
    minWallMm: number | null;
    overhangFraction: number | null;
    trappedVoidCount: number | null;
  } | null;
}

/** Roll a usage summary into (model ms, geometry ms). */
export function splitTiming(usage?: CadUsageSummary | null): {
  modelMs: number;
  geometryMs: number;
} {
  return {
    modelMs: (usage?.model ?? []).reduce((a, m) => a + (m.ms ?? 0), 0),
    geometryMs: usage?.sidecar?.ms ?? 0,
  };
}

function summarizeDfm(report?: CadDfmReport | null): CadRunStats["dfm"] {
  if (!report || report.error) return null;
  return {
    // `?? null`, never `?? true`: an unrun probe is unknown, and a consumer
    // that defaults it to passing recreates the false-pass the report exists
    // to prevent.
    ok: report.ok ?? null,
    probesRan: report.probesRan ?? null,
    minWallMm: report.minWallMm ?? null,
    overhangFraction: report.overhangFraction ?? null,
    trappedVoidCount: report.trappedVoidCount ?? null,
  };
}

export function buildRunStats(opts: {
  engine: CadEngineId;
  ok: boolean;
  attempts: number;
  run?: CadRunResult | null;
  /** Failure message, for classification. Ignored when ok. */
  error?: string | null;
  usage?: CadUsageSummary | null;
}): CadRunStats {
  const { engine, ok, attempts, run } = opts;
  const { modelMs, geometryMs } = splitTiming(opts.usage);
  // Classify from the sidecar's own error when there is one — it carries the
  // kernel stderr the taxonomy's patterns were written against — falling back
  // to the caller's message.
  const note = ok ? null : (run?.error ?? opts.error ?? null);
  return {
    v: 1,
    engine,
    ok,
    attempts,
    failureClass: ok ? null : (classifyKernelError(note)?.class ?? null),
    modelMs,
    geometryMs,
    triangles: run?.geometry?.triangleCount ?? null,
    watertight: run?.validation?.isWatertight ?? null,
    manifold: run?.validation?.isManifold ?? null,
    bodyCount: run?.validation?.bodyCount ?? null,
    remeshed: run?.remeshed ?? false,
    dfm: summarizeDfm(run?.checks?.dfm),
  };
}
