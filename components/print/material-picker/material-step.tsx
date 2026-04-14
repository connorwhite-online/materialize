"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Skeleton } from "@/components/ui/skeleton";
import type { EnrichedQuote } from "./types";
import type { MaterialSummary } from "@/app/actions/catalog";

interface MaterialStepProps {
  quotes: EnrichedQuote[];
  quotesLoading: boolean;
  catalog: MaterialSummary[] | null;
  fileDimensions: { x: number; y: number; z: number } | null;
  onPick: (materialId: string) => void;
}

interface MaterialCard {
  materialId: string;
  materialName: string;
  materialGroupId: string;
  materialGroupName: string;
  materialImage: string | null;
  /**
   * Cheapest quote seen for this material so far. Null until at
   * least one quote for this material has streamed in from the
   * /v5/price poll — the card renders a price skeleton instead.
   */
  cheapest: number | null;
  fastestFast: number | null;
  fastestSlow: number | null;
  configCount: number;
}

/**
 * Does `file` (bounding box in mm) fit inside `build` allowing any
 * axis-aligned rotation? We sort both triples descending and check
 * each slot. Ignores non-axis-aligned rotations, which is fine for
 * a printability hint — the real check happens server-side later.
 */
function fitsInBuildVolume(
  file: { x: number; y: number; z: number },
  build: { x: number; y: number; z: number }
): boolean {
  const f = [file.x, file.y, file.z].sort((a, b) => b - a);
  const b = [build.x, build.y, build.z].sort((a, b) => b - a);
  return f[0] <= b[0] && f[1] <= b[1] && f[2] <= b[2];
}

/**
 * Step 1 — pick a material. While quotes are still polling, we
 * render a skeleton version of the filter chips, section titles,
 * and cards so the layout doesn't reflow when the real data lands.
 */
export function MaterialStep({
  quotes,
  quotesLoading,
  catalog,
  fileDimensions,
  onPick,
}: MaterialStepProps) {
  const { groups, cardsByGroup } = useMemo(() => {
    // Build a per-material quote summary in one pass.
    const quotesByMaterial = new Map<
      string,
      {
        cheapest: number;
        fastestFast: number;
        fastestSlow: number;
        count: number;
      }
    >();
    for (const q of quotes) {
      const existing = quotesByMaterial.get(q.materialId);
      if (!existing) {
        quotesByMaterial.set(q.materialId, {
          cheapest: q.price,
          fastestFast: q.productionTimeFast,
          fastestSlow: q.productionTimeSlow,
          count: 1,
        });
      } else {
        existing.count++;
        if (q.price < existing.cheapest) {
          existing.cheapest = q.price;
          existing.fastestFast = q.productionTimeFast;
          existing.fastestSlow = q.productionTimeSlow;
        }
      }
    }

    // Prefer the full catalog as the source of truth for which
    // cards to render. This means every compatible material is
    // visible immediately, with price/eta as skeletons that swap
    // in as quotes arrive.
    let cards: MaterialCard[];
    if (catalog && catalog.length > 0) {
      const compat = catalog.filter((m) => {
        if (!fileDimensions) return true;
        if (!m.maxDimensions) return true;
        return fitsInBuildVolume(fileDimensions, m.maxDimensions);
      });
      cards = compat.map((m) => {
        const q = quotesByMaterial.get(m.materialId);
        return {
          materialId: m.materialId,
          materialName: m.materialName,
          materialGroupId: m.materialGroupId,
          materialGroupName: m.materialGroupName,
          materialImage: m.materialImage,
          cheapest: q?.cheapest ?? null,
          fastestFast: q?.fastestFast ?? null,
          fastestSlow: q?.fastestSlow ?? null,
          configCount: m.optionCount,
        };
      });
    } else {
      // Fallback: we never loaded the catalog (network glitch,
      // etc.). Derive cards from quotes the old way so the step
      // still works, just without the pre-fill benefit.
      const fromQuotes = new Map<string, MaterialCard>();
      for (const q of quotes) {
        const existing = fromQuotes.get(q.materialId);
        if (!existing) {
          fromQuotes.set(q.materialId, {
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
          if (
            existing.cheapest === null ||
            q.price < existing.cheapest
          ) {
            existing.cheapest = q.price;
            existing.fastestFast = q.productionTimeFast;
            existing.fastestSlow = q.productionTimeSlow;
          }
        }
      }
      cards = Array.from(fromQuotes.values());
    }

    // Priced cards to the top, cheapest first. Unpriced cards
    // (still waiting on quotes, or no quotes returned) sort
    // alphabetically after. Once polling completes and a card
    // still has no quote, the card disappears — see the filter
    // below.
    cards.sort((a, b) => {
      if (a.cheapest !== null && b.cheapest !== null) {
        return a.cheapest - b.cheapest;
      }
      if (a.cheapest !== null) return -1;
      if (b.cheapest !== null) return 1;
      return a.materialName.localeCompare(b.materialName);
    });

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

    // eslint-disable-next-line no-console
    console.log("[MaterialStep] derive", {
      quotesLength: quotes.length,
      catalogLength: catalog?.length ?? null,
      fileDimensions,
      cardsLength: cards.length,
      groupsLength: groups.length,
      pricedCount: cards.filter((c) => c.cheapest !== null).length,
      sampleCatalogIds: catalog?.slice(0, 3).map((m) => m.materialId) ?? null,
      sampleQuoteMaterialIds: quotes.slice(0, 3).map((q) => q.materialId),
    });

    return { groups, cardsByGroup };
  }, [quotes, catalog, fileDimensions]);

  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // Only fall back to the full-page skeleton if we have neither a
  // catalog nor any quotes yet. With the catalog streamed in ahead
  // of time the skeleton never shows at all — each card just has
  // its price field pulse until the matching quote lands.
  if (quotesLoading && quotes.length === 0 && (!catalog || catalog.length === 0)) {
    return <MaterialStepSkeleton />;
  }

  const visibleGroups = activeGroup
    ? groups.filter((g) => g.id === activeGroup)
    : groups;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Select a material</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pick a material family, then a finish, then a vendor.
        </p>
      </div>

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
          const raw = cardsByGroup.get(g.id) ?? [];
          // Once polling has finished, unpriced cards get dropped
          // entirely. During polling they stay in the list as
          // skeletons, so the section count matches what the user
          // sees on screen.
          const cards = quotesLoading
            ? raw
            : raw.filter((c) => c.cheapest !== null);
          if (cards.length === 0) return null;
          return (
            <GroupSection key={g.id} name={g.name} count={cards.length}>
              <div className="grid gap-3 pt-3 sm:grid-cols-2">
                {cards.map((card) => {
                  const priced = card.cheapest !== null;
                  // Polling finished and this material never got a
                  // quote → it's not actually available for this
                  // file. Drop it rather than leave a permanent
                  // skeleton on the screen.
                  if (!priced && !quotesLoading) return null;
                  return (
                    <button
                      key={card.materialId}
                      type="button"
                      onClick={() => priced && onPick(card.materialId)}
                      disabled={!priced}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 disabled:cursor-default disabled:hover:border-border"
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
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span>
                              {card.configCount}{" "}
                              {card.configCount === 1 ? "option" : "options"}
                            </span>
                            <span>·</span>
                            {priced ? (
                              <span>
                                {card.fastestFast}-{card.fastestSlow}d
                              </span>
                            ) : (
                              <Skeleton className="h-2.5 w-10" />
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] text-muted-foreground">
                            from
                          </p>
                          {priced ? (
                            <p className="text-sm font-medium tabular-nums">
                              ${card.cheapest!.toFixed(2)}
                            </p>
                          ) : (
                            <Skeleton className="ml-auto mt-0.5 h-3.5 w-12" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </GroupSection>
          );
        })}
      </div>
    </div>
  );
}

// Width presets so each skeleton card looks slightly different and
// the row doesn't read as a grid of identical bars.
const NAME_WIDTHS = ["w-28", "w-36", "w-24", "w-32", "w-40", "w-28"];
const META_WIDTHS = ["w-24", "w-20", "w-28", "w-16", "w-24", "w-20"];

/**
 * Placeholder rendering for step 1 while quotes are still polling.
 * Every skeleton block matches the size, rounding, and spacing of
 * its real counterpart so the swap-in is a pure opacity fade — no
 * layout reflow.
 */
function MaterialStepSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Select a material</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Loading manufacturer quotes…
        </p>
      </div>

      {/* Filter chip row. Real chips are Button size="xs" =
          h-7 rounded-full. Widths vary to match "All / Nylons /
          Standard Plastics / Steels / Alloys / Composites". */}
      <div className="flex flex-wrap gap-2">
        {["w-10", "w-16", "w-24", "w-14", "w-16", "w-20"].map((w, i) => (
          <Skeleton key={i} className={`h-7 rounded-full ${w}`} />
        ))}
      </div>

      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, sectionIdx) => (
          <section key={sectionIdx}>
            {/* Section title — chevron + group name + count */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-3 w-3 rounded-sm" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, cardIdx) => (
                <div
                  key={cardIdx}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
                >
                  <Skeleton className="h-14 w-14 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Skeleton
                        className={`h-3.5 ${NAME_WIDTHS[cardIdx % NAME_WIDTHS.length]}`}
                      />
                      <Skeleton
                        className={`mt-1 h-2.5 ${META_WIDTHS[cardIdx % META_WIDTHS.length]}`}
                      />
                    </div>
                    <div className="shrink-0 text-right">
                      <Skeleton className="ml-auto h-2 w-5" />
                      <Skeleton className="ml-auto mt-1 h-3.5 w-12" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
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
