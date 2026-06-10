"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronRight } from "@/components/icons/chevron-right";
import type { EnrichedQuote, OptimisticMaterial } from "./types";

const ALL_GROUPS = "all";

interface ShippingLite {
  vendorId: string;
  price: number;
}

interface MaterialStepProps {
  quotes: EnrichedQuote[];
  /**
   * Shipping options from the same /v5/price snapshot. Used as a
   * tiebreaker after CraftCloud's editorial sortIndex — within a
   * tied sortIndex the cheaper-by-total card leads, so US vendors
   * with low shipping aren't dropped below tariff-heavy EU options
   * just because their production is more expensive.
   */
  shipping: ShippingLite[];
  /** Stable quantity anchor for the total-cost tiebreaker. */
  sortQuantity: number;
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
  /**
   * Optimistic material list filtered to those whose build volume
   * fits this model. When set and quote polling hasn't completed
   * yet, materials without a quote render as skeleton-priced cards
   * so the picker shows something immediately. Once polling finishes,
   * any optimistic card without a real quote disappears (no vendors
   * actually quoted it for this region).
   */
  viableMaterials?: OptimisticMaterial[] | null;
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
  materialSortIndex: number;
  /**
   * Null when this card is an optimistic placeholder — a viable
   * material with no real quote yet. The card renders skeletons in
   * place of price + leadtime and is non-interactive (clicking would
   * push the user into a finish step with no quotes to enumerate).
   */
  cheapest: number | null;
  /** Min total (production*qty + shipping) — sort tiebreaker. Null until a quote arrives. */
  cheapestTotal: number | null;
  fastestFast: number | null;
  fastestSlow: number | null;
  configCount: number;
}

/**
 * How many cards to surface in the "Popular materials" section at
 * the top of the picker. CraftCloud's editorial sortIndex puts PLA,
 * SLS Nylon PA12, 316L Steel, Aluminum, and a couple of resins in
 * the first 8 slots — exactly the canonical "what should I pick?"
 * shortlist for a new buyer. Six is enough headroom that the
 * shortlist still has variety after a couple of slots are eaten by
 * resins the user might not be looking for.
 */
const POPULAR_LIMIT = 6;

/**
 * Step 1 — pick a material. Cards are derived from whatever quotes
 * have arrived so far. While the client is still polling and no
 * quotes have landed yet, a thin indeterminate loader sits in for
 * the grid. Once the first snapshot arrives, the grid renders and
 * new cards continue to appear as more vendors respond.
 */
export function MaterialStep({
  quotes,
  shipping,
  sortQuantity,
  quotesLoading,
  quotesPartial = false,
  materialScoped = false,
  viableMaterials = null,
  onRetryQuotes,
  onClearScope,
  onPick,
}: MaterialStepProps) {
  const { groups, cardsByGroup, popularCards, totalCards } = useMemo(() => {
    const byMaterial = new Map<string, MaterialCard>();

    const cheapestShippingByVendor = new Map<string, number>();
    for (const s of shipping) {
      const current = cheapestShippingByVendor.get(s.vendorId);
      if (current === undefined || s.price < current) {
        cheapestShippingByVendor.set(s.vendorId, s.price);
      }
    }
    const totalCost = (q: { price: number; vendorId: string }) =>
      q.price * sortQuantity + (cheapestShippingByVendor.get(q.vendorId) ?? 0);

    // Seed the map with optimistic placeholders for every viable
    // material — these stay visible regardless of whether a quote
    // ever arrives, so the grid never shifts. Cards keep `cheapest:
    // null` until a quote upgrades them; the renderer shows a price-
    // skeleton while polling and a "—" placeholder once polling
    // completes without a quote.
    if (viableMaterials) {
      for (const m of viableMaterials) {
        byMaterial.set(m.id, {
          materialId: m.id,
          materialName: m.name,
          materialGroupId: m.groupId,
          materialGroupName: m.groupName,
          materialImage: m.image,
          materialSortIndex: m.sortIndex,
          cheapest: null,
          cheapestTotal: null,
          fastestFast: null,
          fastestSlow: null,
          configCount: 0,
        });
      }
    }

    for (const q of quotes) {
      const total = totalCost(q);
      const existing = byMaterial.get(q.materialId);
      if (!existing || existing.cheapest === null) {
        byMaterial.set(q.materialId, {
          materialId: q.materialId,
          materialName: q.materialName,
          materialGroupId: q.materialGroupId,
          materialGroupName: q.materialGroupName,
          materialImage: q.materialImage,
          materialSortIndex: q.materialSortIndex,
          cheapest: q.price,
          cheapestTotal: total,
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
        if (existing.cheapestTotal === null || total < existing.cheapestTotal) {
          existing.cheapestTotal = total;
        }
      }
    }

    // Sort by sortIndex first (popularity), total cost as tiebreaker.
    // Within a group section the user reads top-to-bottom expecting
    // the most common pick first; total cost (production*qty +
    // cheapest shipping) is the natural disambiguator only when
    // CraftCloud's curation hasn't said anything. Skeleton cards
    // (cheapestTotal === null) sort with their peers by sortIndex;
    // ties among unpriced cards stay in insertion order, which is fine.
    const cards = Array.from(byMaterial.values()).sort((a, b) => {
      if (a.materialSortIndex !== b.materialSortIndex) {
        return a.materialSortIndex - b.materialSortIndex;
      }
      if (a.cheapestTotal === null && b.cheapestTotal === null) return 0;
      if (a.cheapestTotal === null) return 1;
      if (b.cheapestTotal === null) return -1;
      return a.cheapestTotal - b.cheapestTotal;
    });

    // Top-N popular across all groups. Skip the section entirely when
    // the user has too few materials for a "shortlist" to be
    // distinguishable from "all of them".
    const popularCards =
      cards.length > POPULAR_LIMIT ? cards.slice(0, POPULAR_LIMIT) : [];

    const cardsByGroup = new Map<string, MaterialCard[]>();
    const groupBestSort = new Map<string, number>();
    const groupNames = new Map<string, string>();
    for (const card of cards) {
      if (!cardsByGroup.has(card.materialGroupId)) {
        cardsByGroup.set(card.materialGroupId, []);
        groupNames.set(card.materialGroupId, card.materialGroupName);
        groupBestSort.set(card.materialGroupId, card.materialSortIndex);
      } else {
        const prev = groupBestSort.get(card.materialGroupId) ?? Infinity;
        if (card.materialSortIndex < prev) {
          groupBestSort.set(card.materialGroupId, card.materialSortIndex);
        }
      }
      cardsByGroup.get(card.materialGroupId)!.push(card);
    }

    // Order groups by their best (lowest) sortIndex — so "Standard
    // Plastics" leads because it contains PLA, then "Nylons" because
    // of SLS PA12, etc. Alphabetical fallback is just for stability
    // when two groups happen to tie on their best material.
    const groups = Array.from(groupNames.entries())
      .map(([id, name]) => ({
        id,
        name,
        bestSort: groupBestSort.get(id) ?? Infinity,
      }))
      .sort((a, b) => {
        if (a.bestSort !== b.bestSort) return a.bestSort - b.bestSort;
        return a.name.localeCompare(b.name);
      });

    return { groups, cardsByGroup, popularCards, totalCards: cards.length };
  }, [quotes, shipping, sortQuantity, viableMaterials]);

  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  // Nothing at all to render — fall back to the thin loader. This
  // path now only fires when (a) we don't have viableMaterials yet
  // (dimensions unknown, manifest still in flight, or scoped) AND
  // (b) no real quotes have arrived. With viableMaterials in hand,
  // totalCards > 0 and we render the optimistic skeleton grid below.
  if (quotesLoading && totalCards === 0) {
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
        <div
          role="status"
          className="rounded-xl border border-border bg-muted/20 p-6 text-center"
        >
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
        <div
          role="status"
          className="rounded-xl border border-border bg-muted/20 p-6 text-center"
        >
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
      <div
        role="status"
        className="rounded-xl border border-border bg-muted/20 p-6 text-center"
      >
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

      <Select
        value={activeGroup ?? ALL_GROUPS}
        onValueChange={(value) =>
          setActiveGroup(value === ALL_GROUPS ? null : value)
        }
      >
        <SelectTrigger size="sm" className="min-w-44">
          <SelectValue>
            {(value) => {
              if (value === ALL_GROUPS || value == null) return "All materials";
              return groups.find((g) => g.id === value)?.name ?? "All materials";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_GROUPS}>All materials</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="space-y-4">
        {/* Popular shortlist — only when the user is browsing All. The
            cards here also appear in their respective group sections
            below; that intentional duplication keeps the per-group
            view complete without forcing the user to hunt for PLA. */}
        {activeGroup === null && popularCards.length > 0 && (
          <GroupSection name="Popular" count={popularCards.length}>
            <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2">
              {popularCards.map((card) => (
                <MaterialCardButton
                  key={card.materialId}
                  card={card}
                  quotesLoading={quotesLoading}
                  onPick={onPick}
                />
              ))}
            </div>
          </GroupSection>
        )}

        {visibleGroups.map((g) => {
          const cards = cardsByGroup.get(g.id) ?? [];
          if (cards.length === 0) return null;
          return (
            <GroupSection key={g.id} name={g.name} count={cards.length}>
              <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-2">
                {cards.map((card) => (
                  <MaterialCardButton
                    key={card.materialId}
                    card={card}
                    quotesLoading={quotesLoading}
                    onPick={onPick}
                  />
                ))}
              </div>
            </GroupSection>
          );
        })}
      </div>
    </div>
  );
}

function MaterialCardButton({
  card,
  quotesLoading,
  onPick,
}: {
  card: MaterialCard;
  quotesLoading: boolean;
  onPick: (materialId: string) => void;
}) {
  const priced = card.cheapest !== null;
  // Three states for the price slot:
  //   - priced: real quote arrived, render the price
  //   - pending: still polling, no quote yet — render a skeleton
  //   - unavailable: polling done, no quote came back — render "—"
  // The card itself stays mounted in all three so the grid never
  // shifts. Subtitle is the material group name (always known from
  // the manifest), so it doesn't skeleton-then-swap either.
  const pending = !priced && quotesLoading;
  const interactive = priced;

  return (
    <button
      type="button"
      onClick={() => onPick(card.materialId)}
      disabled={!interactive}
      aria-busy={pending}
      // w-full + min-w-0 keep the button inside its grid cell even when
      // a long material name (e.g. "BASF® Ultrafuse 17-4 PH Steel")
      // would otherwise push min-content past the viewport. Without
      // them iOS Safari treats the page as wider than the viewport
      // and auto-zooms the layout to fit, leaving content visibly
      // clipped on the right edge.
      className="flex w-full min-w-0 items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors enabled:hover:border-primary/40 disabled:cursor-default"
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted/60">
        {card.materialImage && (
          <Image
            src={resolveCatalogImage(card.materialImage)}
            alt=""
            fill
            sizes="56px"
            className="object-cover"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{card.materialName}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {priced
              ? `${card.configCount} ${card.configCount === 1 ? "option" : "options"} · ${card.fastestFast}-${card.fastestSlow}d`
              : card.materialGroupName}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-muted-foreground">from</p>
          {priced ? (
            <p className="text-sm font-medium tabular-nums">
              ${card.cheapest!.toFixed(2)}
            </p>
          ) : pending ? (
            <Skeleton className="mt-1 h-4 w-12" />
          ) : (
            <p className="text-sm font-medium text-muted-foreground tabular-nums">
              —
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

/**
 * Indeterminate progress line. Shared styling with the generic
 * app-route loading.tsx so the print flow reads as the same kind
 * of "something's still working" indicator the rest of the app
 * uses for slow async work.
 */
function LoadingBar({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label ?? "Collecting quotes"}
      className="relative h-0.5 w-full overflow-hidden rounded-full bg-muted"
    >
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
        className="group flex w-full cursor-pointer items-center justify-between gap-2 text-left"
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
          <h3 className="text-sm font-medium text-muted-foreground">
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
