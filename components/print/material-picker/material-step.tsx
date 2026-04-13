"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "@/components/icons/chevron-right";
import { Skeleton } from "@/components/ui/skeleton";
import type { EnrichedQuote } from "./types";

interface MaterialStepProps {
  quotes: EnrichedQuote[];
  quotesLoading: boolean;
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
 * Step 1 — pick a material. While quotes are still polling, we
 * render a skeleton version of the filter chips, section titles,
 * and cards so the layout doesn't reflow when the real data lands.
 */
export function MaterialStep({
  quotes,
  quotesLoading,
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

  // Skeleton branch — same layout shape, same spacing, just greyed
  // out primitives so the real content fades in without reflow.
  if (quotesLoading && quotes.length === 0) {
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
