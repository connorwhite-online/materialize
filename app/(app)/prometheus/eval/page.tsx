import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations, printOrders } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import {
  CAD_FEEDBACK_TAGS,
  CAD_FEEDBACK_TAG_LABELS,
  type CadFeedbackTag,
} from "@/lib/cad/feedback";
import { loadOutcomesRollup } from "@/lib/cad/analysis/outcomes-rollup";
import type { OutcomeMetrics } from "@/lib/cad/analysis/implicit-signals";
import {
  loadCostRollup,
  type CostBucket,
} from "@/lib/cad/analysis/cost-rollup";

export const metadata: Metadata = {
  title: "Prometheus — Scorecard",
  robots: { index: false, follow: false },
};

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

/**
 * Format a 0..1 rate (or null) from the implicit-signal rollup as a percent.
 * Null — the denominator was zero (no saves, no threads) — is an honest "—",
 * never a misleading 0%. Pure + exported for tests (MTR-205).
 */
export function fmtRate(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Format an average (or null) to one decimal, or an honest dash. */
export function fmtAvg(n: number | null): string {
  return n == null ? "—" : n.toFixed(1);
}

/** Aesthetic average (0..100) rounded, or a dash when the judge saw nothing. */
export function fmtScore(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}`;
}

/**
 * Compact cost cell for a route slice (MTR-205). Prefers real dollars when the
 * CAD_PRICE_* units are set (costCents > 0); otherwise falls back to the token
 * volume, which is the useful signal while prices sit at their 0 defaults. A
 * route with no metered jobs shows a dash.
 */
export function fmtCost(bucket: CostBucket | undefined): string {
  if (!bucket || bucket.jobs === 0) return "—";
  if (bucket.costCents > 0) return `$${(bucket.costCents / 100).toFixed(2)}`;
  const tok = bucket.inputTokens + bucket.outputTokens;
  if (tok >= 1000) return `${(tok / 1000).toFixed(1)}k tok`;
  return tok > 0 ? `${tok} tok` : "—";
}

/**
 * Harness scorecard — the "is it getting better?" dashboard. Rolls up the
 * automatic oracle (validity = succeeded), the owner's explicit feedback
 * (👍 rate + failure-tag frequency), and the real outcome (print-through:
 * generations whose asset became a print order). Owner-gated like the studio.
 */
export default async function TextToCadEvalPage() {
  const { userId } = await auth();
  const user = (await currentUser()) as ClerkUserLike;
  if (!userId || !canUseTextToCad(primaryEmail(user))) {
    notFound();
  }

  const gens = await db
    .select({
      status: cadGenerations.status,
      rating: cadGenerations.rating,
      feedbackTags: cadGenerations.feedbackTags,
      attempts: cadGenerations.attempts,
      aestheticScore: cadGenerations.aestheticScore,
      remeshed: cadGenerations.remeshed,
      fileAssetId: cadGenerations.fileAssetId,
    })
    .from(cadGenerations)
    .where(eq(cadGenerations.userId, userId));

  const total = gens.length;
  const succeeded = gens.filter((g) => g.status === "succeeded").length;
  const failed = gens.filter((g) => g.status === "failed").length;
  const good = gens.filter((g) => g.rating === "good").length;
  const bad = gens.filter((g) => g.rating === "bad").length;
  const rated = good + bad;
  const avgAttempts =
    total === 0
      ? 0
      : gens.reduce((s, g) => s + (g.attempts ?? 0), 0) / total;

  // Remesh rate: how often a "valid" result actually came from the lossy
  // voxel-remesh fallback (quality traded for watertightness — a KPI to
  // drive DOWN; docs/text-to-cad/02 §C).
  const remeshedCount = gens.filter(
    (g) => g.status === "succeeded" && g.remeshed
  ).length;

  // Aesthetic score (VLM judge), averaged over rows that have one.
  const scored = gens.filter(
    (g): g is typeof g & { aestheticScore: number } =>
      typeof g.aestheticScore === "number"
  );
  const avgAesthetic =
    scored.length === 0
      ? null
      : Math.round(
          scored.reduce((s, g) => s + g.aestheticScore, 0) / scored.length
        );

  // Tag frequency across all feedback.
  const tagCounts = {} as Record<CadFeedbackTag, number>;
  for (const t of CAD_FEEDBACK_TAGS) tagCounts[t] = 0;
  for (const g of gens) {
    for (const t of g.feedbackTags ?? []) {
      if (t in tagCounts) tagCounts[t as CadFeedbackTag] += 1;
    }
  }

  // Print-through: how many generated assets became print orders.
  const assetIds = gens
    .map((g) => g.fileAssetId)
    .filter((id): id is string => !!id);
  let printedCount = 0;
  if (assetIds.length > 0) {
    const orders = await db
      .select({ fileAssetId: printOrders.fileAssetId })
      .from(printOrders)
      .where(
        and(
          eq(printOrders.userId, userId),
          inArray(printOrders.fileAssetId, assetIds)
        )
      );
    printedCount = new Set(orders.map((o) => o.fileAssetId)).size;
  }

  // Implicit-signal outcomes + cost rollups (MTR-185 / MTR-181), sliced by
  // router verdict and config fingerprint. Both loaders are bounded (createdAt
  // window + row limit) and scoped to this owner, so they never full-scan on
  // page load. Fetched in parallel; a loader hiccup degrades to an empty
  // section rather than blanking the whole scorecard.
  const [outcomes, costs] = await Promise.all([
    loadOutcomesRollup({ userId }).catch(() => null),
    loadCostRollup({ userId }).catch(() => null),
  ]);
  // Join cost onto each route slice by the shared route key (usage.route vs
  // configFingerprint.route — the same verdict string).
  const costByRoute = new Map<string, CostBucket>(
    (costs?.byRoute ?? []).map((b) => [b.key, b])
  );
  const costByFingerprint = new Map<string, CostBucket>(
    (costs?.byFingerprint ?? []).map((b) => [b.key, b])
  );

  const stats: Array<{ label: string; value: string; sub?: string }> = [
    { label: "Generations", value: String(total) },
    {
      label: "Valid (compiled + watertight)",
      value: pct(succeeded, total),
      sub: `${succeeded} ok · ${failed} failed`,
    },
    {
      label: "👍 rate",
      value: pct(good, rated),
      sub: `${good} up · ${bad} down · ${total - rated} unrated`,
    },
    {
      label: "Print-through",
      value: pct(printedCount, succeeded),
      sub: `${printedCount} of ${succeeded} valid models ordered`,
    },
    {
      label: "Aesthetic score",
      value: avgAesthetic === null ? "—" : `${avgAesthetic}/100`,
      sub:
        scored.length === 0
          ? "VLM judge off / no scores yet"
          : `avg over ${scored.length} judged`,
    },
    {
      label: "Remesh rate",
      value: pct(remeshedCount, succeeded),
      sub: `${remeshedCount} of ${succeeded} valid via voxel fallback`,
    },
    { label: "Avg attempts", value: avgAttempts.toFixed(2) },
  ];

  const maxTag = Math.max(1, ...Object.values(tagCounts));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Prometheus — Scorecard
        </h1>
        <Link
          href="/prometheus"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          ← Studio
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        How the harness is doing across your generations. Validity is
        automatic; the 👍 rate and tags are your feedback; print-through is the
        real outcome.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-foreground/10 p-4"
          >
            <div className="text-2xl font-semibold tracking-tight">
              {s.value}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
            {s.sub && (
              <div className="mt-1 text-[11px] text-muted-foreground/80">
                {s.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-medium text-muted-foreground">
        Failure modes (tag frequency)
      </h2>
      {rated === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No feedback yet — rate a few generations in the studio to populate
          this.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {CAD_FEEDBACK_TAGS.map((tag) => (
            <li key={tag} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                {CAD_FEEDBACK_TAG_LABELS[tag]}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full bg-foreground/40"
                  style={{
                    width: `${(tagCounts[tag] / maxTag) * 100}%`,
                  }}
                />
              </div>
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {tagCounts[tag]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Outcomes (MTR-185) — implicit user behavior as continuous quality
          signal, sliced by router verdict then by full config fingerprint,
          with a compact cost column (MTR-181) joined per slice. */}
      <div className="mt-8 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Outcomes (implicit signals)
        </h2>
        {outcomes && (
          <span className="text-[11px] text-muted-foreground/70">
            {outcomes.threads} threads · {outcomes.generations} generations
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground/80">
        Behavior is the richest quality signal — how often a thread reaches a
        save, is abandoned after one try, is revised right after a success
        (frustration proxy), or prints through. Rates read “—” when there’s
        nothing to divide by, never a misleading 0%.
      </p>

      {!outcomes || outcomes.threads === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No generation threads in the window yet — build a few models in the
          studio to populate this.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-6">
          <OutcomesTable
            keyHeader="Route"
            rows={outcomes.byRoute}
            keyLabel={(k) => k}
            costFor={(k) => costByRoute.get(k)}
          />
          {outcomes.byFingerprint.length > 1 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground/80">
                By config fingerprint
              </h3>
              <OutcomesTable
                keyHeader="Config"
                rows={outcomes.byFingerprint}
                keyLabel={fingerprintLabel}
                costFor={(k) => costByFingerprint.get(k)}
              />
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            Save = thread reached a saved file · Abandon = single-generation
            threads never saved · Gens→save = avg generations in a saved thread ·
            Revise-after = revisions off an already-succeeded parent ·
            Print-thru = saved threads whose asset became a print order ·
            Cost = recomputed at current CAD_PRICE_* units, else token volume.
          </p>
        </div>
      )}
    </div>
  );
}

/** Compact, human label for a fingerprint slice key (route + a hash tail). */
function fingerprintLabel(key: string): string {
  if (key === "unknown") return "unknown";
  try {
    const parsed = JSON.parse(key) as { route?: string | null };
    const route = parsed.route ?? "—";
    // The full key is deterministic but long; show the route plus a short,
    // stable suffix so distinct configs on the same route are distinguishable.
    let hash = 0;
    for (let i = 0; i < key.length; i++)
      hash = (hash * 31 + key.charCodeAt(i)) | 0;
    return `${route} · ${(hash >>> 0).toString(36).slice(0, 4)}`;
  } catch {
    return key.slice(0, 24);
  }
}

/**
 * One rollup slice rendered as a scrollable table (MTR-205). Shared by the
 * by-route and by-fingerprint views. Horizontally scrolls on narrow screens so
 * the page body itself never scrolls sideways.
 */
function OutcomesTable({
  keyHeader,
  rows,
  keyLabel,
  costFor,
}: {
  keyHeader: string;
  rows: Array<{ key: string } & OutcomeMetrics>;
  keyLabel: (key: string) => string;
  costFor: (key: string) => CostBucket | undefined;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-foreground/10">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="text-muted-foreground/70">
          <tr className="border-b border-foreground/10">
            <th className="px-3 py-2 font-medium">{keyHeader}</th>
            <th className="px-3 py-2 text-right font-medium">Threads</th>
            <th className="px-3 py-2 text-right font-medium">Save</th>
            <th className="px-3 py-2 text-right font-medium">Abandon</th>
            <th className="px-3 py-2 text-right font-medium">Gens→save</th>
            <th className="px-3 py-2 text-right font-medium">Revise-after</th>
            <th className="px-3 py-2 text-right font-medium">Print-thru</th>
            <th className="px-3 py-2 text-right font-medium">Aesthetic</th>
            <th className="px-3 py-2 text-right font-medium">Remesh</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => (
            <tr
              key={r.key}
              className="border-b border-foreground/5 last:border-0"
            >
              <td
                className="max-w-[180px] truncate px-3 py-2 font-medium"
                title={r.key}
              >
                {keyLabel(r.key)}
              </td>
              <td className="px-3 py-2 text-right">{r.threads}</td>
              <td className="px-3 py-2 text-right">{fmtRate(r.saveRate)}</td>
              <td className="px-3 py-2 text-right">{fmtRate(r.abandonRate)}</td>
              <td className="px-3 py-2 text-right">
                {fmtAvg(r.avgGenerationsToSave)}
              </td>
              <td className="px-3 py-2 text-right">{r.reviseAfterSuccess}</td>
              <td className="px-3 py-2 text-right">
                {fmtRate(r.printThroughRate)}
              </td>
              <td className="px-3 py-2 text-right">{fmtScore(r.avgAesthetic)}</td>
              <td className="px-3 py-2 text-right">{fmtRate(r.remeshRate)}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {fmtCost(costFor(r.key))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
