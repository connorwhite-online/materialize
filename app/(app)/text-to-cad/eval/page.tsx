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

export const metadata: Metadata = {
  title: "Text to CAD — Scorecard",
  robots: { index: false, follow: false },
};

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
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
    { label: "Avg attempts", value: avgAttempts.toFixed(2) },
  ];

  const maxTag = Math.max(1, ...Object.values(tagCounts));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Text to CAD — Scorecard
        </h1>
        <Link
          href="/text-to-cad"
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
    </div>
  );
}
