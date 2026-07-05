/**
 * Implicit-signal rollup (MTR-185): turn already-persisted user behavior into
 * continuous outcome metrics, sliced by router verdict (`configFingerprint.
 * route`) and by full config fingerprint, so config changes are comparable on
 * real traffic without manual experiments.
 *
 * Explicit 👍/👎 ratings are sparse; the richest quality signal is implicit —
 * how many revisions to a save, threads abandoned after the first attempt,
 * revising immediately after a success (frustration proxy), and print-through.
 * All of it is in cad_threads + cad_generations already.
 *
 * PURE: no DB, no env. The loader (./outcomes-rollup.ts) fetches the rows and
 * the print-order join; this file is just the aggregation, so it unit-tests
 * with plain arrays.
 */

export interface ThreadInput {
  id: string;
  savedFileId?: string | null;
}

export interface GenInput {
  id: string;
  threadId?: string | null;
  status: string;
  parentGenerationId?: string | null;
  fileAssetId?: string | null;
  aestheticScore?: number | null;
  remeshed?: boolean | null;
  /** configFingerprint.route for this generation. */
  route?: string | null;
  /** Full configFingerprint (for fingerprint-keyed slicing). */
  fingerprint?: unknown;
}

export interface OutcomeMetrics {
  threads: number;
  generations: number;
  saved: number;
  /** saved / threads. */
  saveRate: number | null;
  /** 1-generation threads that were never saved. */
  abandonedAfterFirst: number;
  abandonRate: number | null;
  /** Avg generations in a saved thread (revision count to a save, proxy). */
  avgGenerationsToSave: number | null;
  /** Revisions whose parent generation had SUCCEEDED — a frustration proxy. */
  reviseAfterSuccess: number;
  /** Threads with any generation whose asset became a print order. */
  printThroughThreads: number;
  /** printThroughThreads / saved. */
  printThroughRate: number | null;
  /** Avg aesthetic score over generations that have one. */
  avgAesthetic: number | null;
  /** Succeeded generations produced via the lossy voxel remesh. */
  remeshRate: number | null;
}

function emptyMetrics(): OutcomeMetrics & {
  _aestheticSum: number;
  _aestheticN: number;
  _succeeded: number;
  _remeshed: number;
  _savedGenSum: number;
} {
  return {
    threads: 0,
    generations: 0,
    saved: 0,
    saveRate: null,
    abandonedAfterFirst: 0,
    abandonRate: null,
    avgGenerationsToSave: null,
    reviseAfterSuccess: 0,
    printThroughThreads: 0,
    printThroughRate: null,
    avgAesthetic: null,
    remeshRate: null,
    _aestheticSum: 0,
    _aestheticN: 0,
    _succeeded: 0,
    _remeshed: 0,
    _savedGenSum: 0,
  };
}

/** Pick the attribution route for a thread: its earliest generation's route. */
export function pickThreadRoute(threadGens: GenInput[]): string {
  for (const g of threadGens) {
    if (g.route) return g.route;
  }
  return "unknown";
}

/**
 * Deterministic compact key for a config fingerprint — stable across object
 * key order so the same config always hashes to the same slice. Uses
 * models + flags + route (the treatment), ignoring the `v` version tag.
 */
export function fingerprintKey(fp: unknown): string {
  if (!fp || typeof fp !== "object") return "unknown";
  const obj = fp as Record<string, unknown>;
  const stable = {
    route: obj.route ?? null,
    models: sortedRecord(obj.models),
    flags: sortedRecord(obj.flags),
  };
  return JSON.stringify(stable);
}

function sortedRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object") return {};
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

/** Pick the attribution fingerprint key for a thread: its earliest gen's. */
export function pickThreadFingerprintKey(threadGens: GenInput[]): string {
  for (const g of threadGens) {
    if (g.fingerprint) return fingerprintKey(g.fingerprint);
  }
  return "unknown";
}

/**
 * Aggregate per-thread outcomes into groups keyed by `keyOf`. Generations are
 * attributed to their thread; a thread (and all its metrics) is attributed to
 * the single key `keyOf` returns for it — so "outcomes sliced by route /
 * fingerprint" is one call with the right key function.
 */
export function rollupOutcomes(
  threads: ThreadInput[],
  gens: GenInput[],
  printedAssetIds: ReadonlySet<string>,
  keyOf: (thread: ThreadInput, threadGens: GenInput[]) => string
): Map<string, OutcomeMetrics> {
  const genById = new Map(gens.map((g) => [g.id, g]));
  const gensByThread = new Map<string, GenInput[]>();
  for (const g of gens) {
    if (!g.threadId) continue;
    const list = gensByThread.get(g.threadId);
    if (list) list.push(g);
    else gensByThread.set(g.threadId, [g]);
  }

  const groups = new Map<string, ReturnType<typeof emptyMetrics>>();
  const groupFor = (key: string) => {
    let m = groups.get(key);
    if (!m) {
      m = emptyMetrics();
      groups.set(key, m);
    }
    return m;
  };

  for (const thread of threads) {
    const threadGens = gensByThread.get(thread.id) ?? [];
    const m = groupFor(keyOf(thread, threadGens));

    m.threads += 1;
    m.generations += threadGens.length;
    const isSaved = thread.savedFileId != null;
    if (isSaved) {
      m.saved += 1;
      m._savedGenSum += threadGens.length;
    }
    if (threadGens.length <= 1 && !isSaved) m.abandonedAfterFirst += 1;

    let printedThrough = false;
    for (const g of threadGens) {
      if (typeof g.aestheticScore === "number") {
        m._aestheticSum += g.aestheticScore;
        m._aestheticN += 1;
      }
      if (g.status === "succeeded") {
        m._succeeded += 1;
        if (g.remeshed) m._remeshed += 1;
      }
      if (g.parentGenerationId) {
        const parent = genById.get(g.parentGenerationId);
        if (parent?.status === "succeeded") m.reviseAfterSuccess += 1;
      }
      if (g.fileAssetId && printedAssetIds.has(g.fileAssetId)) {
        printedThrough = true;
      }
    }
    if (printedThrough) m.printThroughThreads += 1;
  }

  const finalized = new Map<string, OutcomeMetrics>();
  for (const [key, m] of groups) {
    finalized.set(key, {
      threads: m.threads,
      generations: m.generations,
      saved: m.saved,
      saveRate: m.threads ? m.saved / m.threads : null,
      abandonedAfterFirst: m.abandonedAfterFirst,
      abandonRate: m.threads ? m.abandonedAfterFirst / m.threads : null,
      avgGenerationsToSave: m.saved ? m._savedGenSum / m.saved : null,
      reviseAfterSuccess: m.reviseAfterSuccess,
      printThroughThreads: m.printThroughThreads,
      printThroughRate: m.saved ? m.printThroughThreads / m.saved : null,
      avgAesthetic: m._aestheticN ? m._aestheticSum / m._aestheticN : null,
      remeshRate: m._succeeded ? m._remeshed / m._succeeded : null,
    });
  }
  return finalized;
}

/** Convenience: the two standard slices (by route, by fingerprint). */
export function rollupByRouteAndFingerprint(
  threads: ThreadInput[],
  gens: GenInput[],
  printedAssetIds: ReadonlySet<string>
): {
  byRoute: Map<string, OutcomeMetrics>;
  byFingerprint: Map<string, OutcomeMetrics>;
} {
  return {
    byRoute: rollupOutcomes(threads, gens, printedAssetIds, (_t, g) =>
      pickThreadRoute(g)
    ),
    byFingerprint: rollupOutcomes(threads, gens, printedAssetIds, (_t, g) =>
      pickThreadFingerprintKey(g)
    ),
  };
}
