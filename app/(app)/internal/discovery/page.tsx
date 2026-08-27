import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { resolveInternalToolsAccess } from "@/lib/features";
import {
  BROWSE_FILES_SHOWN,
  fetchFileCandidatePool,
} from "@/lib/discovery/browse-pool";
import { explainBrowseRanking, DISCOVERY_PARAMS } from "@/lib/discovery";
import { fmtAge, fmtFactor, fmtScore, fmtShare } from "./format";

// Operator surface — keep it out of search indexes even if the gate is
// ever misconfigured.
export const metadata: Metadata = {
  title: "Discovery ranking",
  robots: { index: false, follow: false },
};

// The pool query and its recency aggregate must reflect the catalogue
// as it is right now, not as it was when the page was last built.
export const dynamic = "force-dynamic";

/**
 * The discovery ranking inspector.
 *
 * The browse grid ranks by a score nobody can see, which meant the
 * ranking layer shipped with no way to check it against a real
 * catalogue — the one gap called out when it merged. This page runs
 * the *same* pool fetch and the *same* ranking as `/files`
 * (`fetchFileCandidatePool` → `explainBrowseRanking`, both shared with
 * the grid) and shows the arithmetic instead of the cards.
 *
 * Read-only, deliberately. Editing `DISCOVERY_PARAMS` from here would
 * need runtime-mutable params — a store, a cached read on every
 * ranking call, and a second DB-touching path through a layer that
 * currently has exactly one. It is also premature: with no impression
 * logging there is no signal that would tell you whether a tuning
 * change helped, so sliders would only make wrong changes faster. The
 * params are printed below instead, and tuning stays a one-file diff.
 */
export default async function DiscoveryInspectorPage() {
  if (!(await resolveInternalToolsAccess())) notFound();

  const now = new Date();
  const pool = await fetchFileCandidatePool({ now });
  const ranked = explainBrowseRanking(pool, {
    creatorKey: (f) => f.username,
    now,
  });

  const params = DISCOVERY_PARAMS.popularity;
  const diversity = DISCOVERY_PARAMS.browseDiversity;
  const discounted = ranked.filter((r) => r.diversityFactor < 1).length;
  const fromFreshOnly = pool.filter(
    (c) => c.pools.length === 1 && c.pools[0] === "fresh"
  ).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">
          Discovery ranking
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          The live browse pool, scored by the same code{" "}
          <Link href="/files" className="underline underline-offset-2">
            /files
          </Link>{" "}
          runs. The top{" "}
          <span className="tabular-nums">{BROWSE_FILES_SHOWN}</span> rows, above
          the rule, are what the grid actually renders.
        </p>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pool" value={`${pool.length}`} hint="candidates fetched" />
        <Stat
          label="Fresh-only"
          value={`${fromFreshOnly}`}
          hint="would miss a popularity-only pool"
        />
        <Stat
          label="Discounted"
          value={`${discounted}`}
          hint="demoted for creator diversity"
        />
        <Stat
          label="Window"
          value={`${params.recentWindowDays}d`}
          hint="recent-download window"
        />
      </dl>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <Th className="w-10">#</Th>
              <Th>File</Th>
              <Th>Creator</Th>
              <Th className="text-right">Score</Th>
              <Th className="text-right">Base</Th>
              <Th className="text-right">Recent</Th>
              <Th className="text-right">All-time</Th>
              <Th className="text-right">Fresh</Th>
              <Th className="text-right">Diversity</Th>
              <Th className="text-right">Age</Th>
              <Th>Pools</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((entry) => {
              const { row, popularity } = entry;
              // The rule marks the grid's cut, so near-misses are
              // visible next to what beat them.
              const isCutoff = entry.rank === BROWSE_FILES_SHOWN;
              return (
                <tr
                  key={row.id}
                  className={`border-t border-border/60 ${
                    isCutoff ? "border-b-2 border-b-primary/40" : ""
                  }`}
                >
                  <Td className="tabular-nums text-muted-foreground">
                    {entry.rank}
                  </Td>
                  <Td className="max-w-[18rem] truncate">
                    <Link
                      href={`/files/${row.slug}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                  </Td>
                  <Td className="text-muted-foreground">
                    {row.username ? `@${row.username}` : "—"}
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {fmtScore(entry.score)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {fmtScore(popularity.total)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {fmtScore(popularity.recent)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {fmtShare(popularity.recent, popularity.total)}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {fmtScore(popularity.allTime)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {fmtShare(popularity.allTime, popularity.total)}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {fmtScore(popularity.freshness)}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {fmtShare(popularity.freshness, popularity.total)}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {fmtFactor(entry.diversityFactor)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {fmtAge(row.createdAt, now)}
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {row.pools.join(" + ")}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ranked.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No published files in the pool.
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium">Params</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Read-only. These live in{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            lib/discovery/params.ts
          </code>{" "}
          — tuning is a one-file diff, not a setting.
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <Param name="recentWeight" value={params.recentWeight} />
          <Param name="allTimeWeight" value={params.allTimeWeight} />
          <Param name="freshnessBoost" value={params.freshnessBoost} />
          <Param
            name="freshnessHalfLifeDays"
            value={params.freshnessHalfLifeDays}
          />
          <Param name="diversity.decay" value={diversity.decay} />
          <Param name="diversity.floor" value={diversity.floor} />
        </dl>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Param({ name, value }: { name: string; value: number }) {
  return (
    <div className="flex justify-between gap-2 border-b border-border/50 py-1">
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
