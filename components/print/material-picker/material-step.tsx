"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "@/components/icons/chevron-right";
import type { EnrichedQuote } from "./types";

interface MaterialStepProps {
  quotes: EnrichedQuote[];
  quotesLoading: boolean;
  /**
   * True when polling exited at the hard ceiling without seeing the
   * stable allComplete signal — the quotes shown are partial, late
   * vendors might still arrive on a retry.
   */
  quotesPartial?: boolean;
  /**
   * True when the parent passed a `preselectMaterialId` — the user
   * came in via "Print with X" and the price request was scoped to
   * that one material. Empty-results in this branch are usually
   * transient vendor unavailability, not a too-big-to-print case.
   */
  materialScoped?: boolean;
  /** Re-runs the quote fetch from scratch. */
  onRetryQuotes?: () => void;
  /**
   * Drops the parent's preselect scope so a refetch returns the
   * full unscoped quote set. Used in the scoped-empty branch to
   * offer "browse other materials" as a recovery action.
   */
  onClearScope?: () => void;
  onPick: (materialId: string) => void;
}

interface MaterialCard {
  materialId: string;
  materialName: string;
  materialGroupId: string;
  materialGroupName: string;
  materialImage: string | null;
  cheapest: number;
  fastestFast: number;
  fastestSlow: number;
  configCount: number;
}

/**
 * Step 1 — pick a material. Cards are derived from whatever quotes
 * have arrived so far. While the client is still polling and no
 * quotes have landed yet, a thin indeterminate loader sits in for
 * the grid. Once the first snapshot arrives, the grid renders and
 * new cards continue to appear as more vendors respond.
 */
export function MaterialStep({
  quotes,
  quotesLoading,
  quotesPartial = false,
  materialScoped = false,
  onRetryQuotes,
  onClearScope,
  onPick,
}: MaterialStepProps) {
  const { groups, cardsByGroup } = useMemo(() => {
    const byMaterial = new Map<string, MaterialCard>();

    for (const q of quotes) {
      const existing = byMaterial.get(q.materialId);
      if (!existing) {
        byMaterial.set(q.materialId, {
          materialId: q.materialId,
          materialName: q.materialName,
          materialGroupId: q.materialGroupId,
          materialGroupName: q.materialGroupName,
          materialImage: q.materialImage,
          cheapest: q.price,
          fastestFast: q.productionTimeFast,
          fastestSlow: q.productionTimeSlow,
          configCount: 1,
        });
      } else {
        existing.configCount++;
        if (q.price < existing.cheapest) {
          existing.cheapest = q.price;
          existing.fastestFast = q.productionTimeFast;
          existing.fastestSlow = q.productionTimeSlow;
        }
      }
    }

    const cards = Array.from(byMaterial.values()).sort(
      (a, b) => a.cheapest - b.cheapest
    );

    const cardsByGroup = new Map<string, MaterialCard[]>();
    const groupNames = new Map<string, string>();
    for (const card of cards) {
      if (!cardsByGroup.has(card.materialGroupId)) {
        cardsByGroup.set(card.materialGroupId, []);
        groupNames.set(card.materialGroupId, card.materialGroupName);
      }
      cardsByGroup.get(card.materialGroupId)!.push(card);
    }

    const groups = Array.from(groupNames.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { groups, cardsByGroup };
  }, [quotes]);

  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // Nothing to show yet — render a thin indeterminate loader while
  // we wait for the first snapshot. As soon as any quotes land the
  // grid takes over, and further arrivals just append cards.
  if (quotesLoading && quotes.length === 0) {
    return <MaterialStepLoading />;
  }

  // Polling finished with no quotes. Three sub-cases drive different
  // copy + recovery actions:
  //
  //   - timeout (quotesPartial=true): the loop hit the hard ceiling
  //     before CraftCloud reported a stable allComplete. Slow vendor
  //     responses, mobile network throttling — retrying usually fixes
  //     it.
  //
  //   - scoped + complete: a "Print with X" entry constrained the
  //     request to one material. With niche materials (copper,
  //     titanium) the legitimate vendor count is tiny and individual
  //     vendor flakiness can produce a transient zero. The generic
  //     "model exceeds print volume" copy is misleading here — guide
  //     the user to retry or browse other materials.
  //
  //   - unscoped + complete: a real empty result. The geometry is
  //     too big for every vendor in the region, or no producer ships
  //     to the selected country. Keep the original copy — it matches
  //     the actual problem.
  if (!quotesLoading && quotes.length === 0) {
    if (quotesPartial) {
      return (
        <div className="rounded-xl border border-border bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium">
            Couldn&apos;t reach all vendors in time
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs text-muted-foreground">
            CraftCloud is slow to respond right now. Retry — most quotes
            will arrive within a few seconds.
          </p>
          {onRetryQuotes && (
            <Button
              variant="outline"
              className="mt-3"
              onClick={onRetryQuotes}
            >
              Retry
            </Button>
          )}
        </div>
      );
    }
    if (materialScoped) {
      return (
        <div className="rounded-xl border border-border bg-muted/20 p-6 text-center">
          <p className="text-sm font-medium">
            No vendors are quoting this material right now
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs text-muted-foreground">
            Specialty materials are produced by a handful of vendors and
            sometimes none respond in time. Retry, or browse other
            materials that work for your model.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {onRetryQuotes && (
              <Button variant="outline" onClick={onRetryQuotes}>
                Retry
              </Button>
            )}
            {onClearScope && (
              <Button variant="ghost" onClick={onClearScope}>
                Try a different material
              </Button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-6 text-center">
        <p className="text-sm font-medium">No quotes available for this file</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs text-muted-foreground">
          This usually means the model exceeds every vendor&apos;s print volume,
          or no vendor in the selected region can produce it. Try changing
          the &quot;Ship to&quot; region above, or scaling the model down.
        </p>
      </div>
    );
  }

  const visibleGroups = activeGroup
    ? groups.filter((g) => g.id === activeGroup)
    : groups;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Select a material</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {quotesLoading
            ? "Still collecting quotes — more options will appear as vendors respond."
            : "Pick a material family, then a finish, then a vendor."}
        </p>
      </div>

      {quotesLoading && <LoadingBar />}

      {!quotesLoading && quotesPartial && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span className="font-medium">Showing partial results.</span>{" "}
          Some vendors didn&apos;t respond in time — a cheaper option may
          appear if you{" "}
          {onRetryQuotes ? (
            <button
              type="button"
              onClick={onRetryQuotes}
              className="underline underline-offset-2 hover:text-amber-700"
            >
              retry
            </button>
          ) : (
            "retry"
          )}
          .
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeGroup === null ? "secondary" : "ghost"}
          size="xs"
          onClick={() => setActiveGroup(null)}
        >
          All
        </Button>
        {groups.map((g) => (
          <Button
            key={g.id}
            variant={activeGroup === g.id ? "secondary" : "ghost"}
            size="xs"
            onClick={() =>
              setActiveGroup((prev) => (prev === g.id ? null : g.id))
            }
          >
            {g.name}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {visibleGroups.map((g) => {
          const cards = cardsByGroup.get(g.id) ?? [];
          if (cards.length === 0) return null;
          return (
            <GroupSection key={g.id} name={g.name} count={cards.length}>
              <div className="grid gap-3 pt-3 sm:grid-cols-2">
                {cards.map((card) => (
                  <button
                    key={card.materialId}
                    type="button"
                    onClick={() => onPick(card.materialId)}
                    className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/60">
                      {card.materialImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolveCatalogImage(card.materialImage)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {card.materialName}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {card.configCount}{" "}
                          {card.configCount === 1 ? "option" : "options"} ·{" "}
                          {card.fastestFast}-{card.fastestSlow}d
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] text-muted-foreground">
                          from
                        </p>
                        <p className="text-sm font-medium tabular-nums">
                          ${card.cheapest.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </GroupSection>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Indeterminate progress line. Shared styling with the generic
 * app-route loading.tsx so the print flow reads as the same kind
 * of "something's still working" indicator the rest of the app
 * uses for slow async work.
 */
function LoadingBar() {
  return (
    <div className="relative h-0.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="absolute inset-y-0 left-0 w-1/3 animate-[material-loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-foreground/60" />
      <style>{`
        @keyframes material-loading-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}

/**
 * First-paint state while we wait for the initial poll snapshot.
 * No fake skeleton cards — just the header copy and a thin loader
 * so the user knows something's happening without pretending to
 * preview content that hasn't been quoted yet.
 */
function MaterialStepLoading() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Select a material</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Collecting quotes from manufacturers worldwide…
        </p>
      </div>
      <LoadingBar />
    </div>
  );
}

/**
 * Collapsible material-group section. Mirrors CollectionSection's
 * pattern — chevron on the left, count badge on the right, smooth
 * height animation. Defaults open; user can collapse groups they
 * aren't interested in as they browse.
 */
function GroupSection({
  name,
  count,
  children,
}: {
  name: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
          >
            <ChevronRight size={14} />
          </motion.span>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {name}
          </h3>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {count} {count === 1 ? "material" : "materials"}
        </p>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="-mx-4 -mb-4 overflow-hidden px-4 pb-4"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function resolveCatalogImage(path: string): string {
  if (path.startsWith("http")) return path;
  return `https://res.cloudinary.com/all3dp/image/upload/w_200,q_auto,f_auto/${path}`;
}
