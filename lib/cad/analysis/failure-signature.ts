/**
 * Failure-signature normalization + clustering (MTR-186).
 *
 * Every failed cadGenerations row already persists its `error` and
 * `sourceCode` — flywheel data nothing consumed. This module turns that
 * pile into clustered, recurring failure signatures so recurring classes can
 * be surfaced as candidate `repairHintFor` cases (human-gated — nothing here
 * auto-injects anything).
 *
 * PURE: no DB, no model, no env. The DB load + coverage check + optional
 * model-drafted hint live in ./failure-miner.ts; this file is just the
 * text→signature→cluster math, so it unit-tests without any infrastructure.
 */

/** Minimal shape of a failed generation the miner feeds in. */
export interface FailureRecord {
  id: string;
  error: string;
  sourceCode?: string | null;
  createdAt?: Date | string | null;
}

export interface FailureExample {
  id: string;
  error: string;
  sourceCode?: string | null;
}

export interface FailureCluster {
  /** Normalized signature (the cluster key). */
  signature: string;
  /** A representative raw error (the first row's, unnormalized). */
  representative: string;
  count: number;
  /** Up to `maxExamples` example rows (raw error + code) for hint drafting. */
  examples: FailureExample[];
}

/**
 * Collapse a raw error message into a stable signature by stripping the
 * volatile parts (ids, addresses, numbers, quoted names) so two instances of
 * the same failure class hash together. Multi-line tracebacks collapse to
 * their final (actual-error) line first.
 *
 * Deterministic and case-normalized so it's a usable map key.
 */
export function normalizeErrorSignature(error: string): string {
  let s = (error ?? "").trim();
  if (!s) return "";

  // A Python traceback's last non-empty line is the actual error; the frames
  // above it are noise that would fragment the cluster.
  const lines = s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 1) s = lines[lines.length - 1];

  return s
    // UUIDs first (they contain hex + digits the later rules would mangle).
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<id>"
    )
    // Memory addresses (object reprs: <Foo object at 0x...>).
    .replace(/0x[0-9a-f]+/gi, "<addr>")
    // Quoted strings/names ('result', "Box", `foo`) — the varying identifier
    // in "name '<x>' is not defined" etc.
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "<str>")
    // Any remaining number (ints, decimals, scientific, signed).
    .replace(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi, "<n>")
    // Collapse a run of placeholders ("<n>, <n>, <n>") to one, so a
    // variable-length list (e.g. per-solid volumes) doesn't fragment the
    // cluster by count.
    .replace(/<n>(?:[\s,]+<n>)+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ClusterOptions {
  /** Drop clusters with fewer than this many rows (default 1). */
  minCount?: number;
  /** Max example rows kept per cluster (default 3). */
  maxExamples?: number;
}

/**
 * Group failures by normalized signature, sorted by frequency (desc), keeping
 * a few examples per cluster. Rows with an empty error are ignored.
 */
export function clusterFailures(
  rows: FailureRecord[],
  opts: ClusterOptions = {}
): FailureCluster[] {
  const minCount = opts.minCount ?? 1;
  const maxExamples = opts.maxExamples ?? 3;

  const bySig = new Map<string, FailureCluster>();
  for (const row of rows) {
    const signature = normalizeErrorSignature(row.error);
    if (!signature) continue;
    let cluster = bySig.get(signature);
    if (!cluster) {
      cluster = {
        signature,
        representative: row.error.trim(),
        count: 0,
        examples: [],
      };
      bySig.set(signature, cluster);
    }
    cluster.count += 1;
    if (cluster.examples.length < maxExamples) {
      cluster.examples.push({
        id: row.id,
        error: row.error,
        sourceCode: row.sourceCode ?? null,
      });
    }
  }

  return [...bySig.values()]
    .filter((c) => c.count >= minCount)
    .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
}

/** A generation row for repair-efficacy: who its parent is + its outcome. */
export interface GenerationOutcome {
  id: string;
  parentGenerationId?: string | null;
  status: string;
  error?: string | null;
}

export interface SignatureEfficacy {
  signature: string;
  /** Failed generations of this signature that HAD a follow-up attempt. */
  attempts: number;
  /** Of those, how many had a child generation that succeeded. */
  repaired: number;
  /** repaired / attempts, or null when attempts === 0. */
  rate: number | null;
}

/**
 * Per-signature repair success rate: a failure with signature X whose child
 * (a generation whose parentGenerationId points at it) later SUCCEEDED counts
 * as repaired. This is how a hint's efficacy is tracked so stale hints can be
 * rotated out (MTR-186 acceptance: scorecard shows per-signature repair rate).
 *
 * `attempts` only counts failures that actually had a follow-up attempt, so a
 * failure the user simply abandoned doesn't drag the rate down.
 */
export function computeRepairEfficacy(
  gens: GenerationOutcome[]
): SignatureEfficacy[] {
  const childrenByParent = new Map<string, GenerationOutcome[]>();
  for (const g of gens) {
    if (!g.parentGenerationId) continue;
    const list = childrenByParent.get(g.parentGenerationId);
    if (list) list.push(g);
    else childrenByParent.set(g.parentGenerationId, [g]);
  }

  const agg = new Map<string, { attempts: number; repaired: number }>();
  for (const g of gens) {
    if (g.status !== "failed" || !g.error) continue;
    const children = childrenByParent.get(g.id);
    if (!children || children.length === 0) continue; // no follow-up attempt
    const signature = normalizeErrorSignature(g.error);
    if (!signature) continue;
    const entry = agg.get(signature) ?? { attempts: 0, repaired: 0 };
    entry.attempts += 1;
    if (children.some((c) => c.status === "succeeded")) entry.repaired += 1;
    agg.set(signature, entry);
  }

  return [...agg.entries()]
    .map(([signature, { attempts, repaired }]) => ({
      signature,
      attempts,
      repaired,
      rate: attempts === 0 ? null : repaired / attempts,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}
