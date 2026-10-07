"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronRight } from "@/components/icons/chevron-right";
import { DottedSpinner } from "@/components/icons/dotted-spinner";
import { cn } from "@/lib/utils";
import { resolveCatalogImage } from "./catalog-image";
import type { EnrichedQuote, OptimisticMaterial } from "./types";
import type { ShippingLite as ShippingOptionLite } from "./finish-cards";
import {
  effectiveUnitPrice,
  pickMinimumProbes,
  quoteTotal,
  type MinimumProbe,
  type VendorMinimums,
} from "./vendor-minimums";

/** Sentinel view ids — CraftCloud group ids are UUIDs, so no clash. */
const POPULAR = "__popular__";
const ALL = "__all__";
type MaterialView = string;

interface MaterialStepProps {
  quotes: EnrichedQuote[];
  /**
   * Shipping options from the same /v5/price snapshot. Used as a
   * tiebreaker after CraftCloud's editorial sortIndex — within a
   * tied sortIndex the cheaper-by-total card leads, so US vendors
   * with low shipping aren't dropped below tariff-heavy EU options
   * just because their production is more expensive.
   */
  shipping: ShippingOptionLite[];
  /** Vendor minimum order values probed so far (see vendor-minimums.ts). */
  vendorMinimums?: VendorMinimums;
  /**
   * Asks the parent to probe these vendors' minimums. Called once
   * polling settles, for the few cheapest vendors of each material.
   */
  onRequestMinimums?: (probes: MinimumProbe[]) => void;
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
   * push the user into a vendor step with no quotes to enumerate).
   */
  cheapest: number | null;
  /** Min total (production*qty + minimum fee + shipping) — sort tiebreaker. Null until a quote arrives. */
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
 * shortlist for a new buyer. Eight is enough headroom that the
 * shortlist still has variety after a couple of slots are eaten by
 * resins the user might not be looking for.
 */
const POPULAR_LIMIT = 8;

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
  vendorMinimums,
  onRequestMinimums,
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
      quoteTotal(q, sortQuantity, cheapestShippingByVendor, vendorMinimums);
    const unitPrice = (q: { price: number; vendorId: string }) =>
      effectiveUnitPrice(q, sortQuantity, vendorMinimums);

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
          cheapest: unitPrice(q),
          cheapestTotal: total,
          fastestFast: q.productionTimeFast,
          fastestSlow: q.productionTimeSlow,
          configCount: 1,
        });
      } else {
        existing.configCount++;
        const unit = unitPrice(q);
        if (unit < existing.cheapest) {
          existing.cheapest = unit;
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
  }, [quotes, shipping, sortQuantity, viableMaterials, vendorMinimums]);

  // Once the quote set settles, probe the few cheapest vendors of each
  // material for their minimum order value so the "from" prices and
  // the ranking include it. The parent dedupes vendors it has already
  // probed, so re-running on a quantity change is cheap.
  useEffect(() => {
    if (quotesLoading || !onRequestMinimums || quotes.length === 0) return;
    onRequestMinimums(pickMinimumProbes(quotes, shipping, sortQuantity));
  }, [quotesLoading, onRequestMinimums, quotes, shipping, sortQuantity]);

  // What the list is showing. "popular" is the short default — the
  // handful of materials most people print in — so the step opens on
  // eight rows, not two hundred. "all" shows every family, each
  // trimmed to a preview with a way into the full family. A group id
  // shows that one family in full.
  const [view, setView] = useState<MaterialView>(POPULAR);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MaterialSort>("recommended");

  // Focus the heading on mount so returning to the material step via
  // "Back" moves keyboard/SR focus here (CON-157).
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Once polling is done, a material with no quote can't be ordered —
  // drop it rather than leave a row of dashes. While polling, it stays
  // as a skeleton-priced row so the list doesn't jump around.
  const isListed = (card: MaterialCard) =>
    card.cheapest !== null || quotesLoading;

  const sortCards = (cards: MaterialCard[]) => {
    if (sort === "recommended") return cards;
    const key = (c: MaterialCard) =>
      sort === "price" ? c.cheapestTotal : c.fastestFast;
    return [...cards].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null && kb === null) return 0;
      if (ka === null) return 1;
      if (kb === null) return -1;
      return ka - kb;
    });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = normalizedQuery
    ? sortCards(
        Array.from(cardsByGroup.values())
          .flat()
          .filter(
            (c) =>
              isListed(c) &&
              (c.materialName.toLowerCase().includes(normalizedQuery) ||
                c.materialGroupName.toLowerCase().includes(normalizedQuery)),
          ),
      )
    : null;

  // Nothing at all to render — fall back to the thin loader. This
  // path now only fires when (a) we don't have viableMaterials yet
  // (dimensions unknown, manifest still in flight, or scoped) AND
  // (b) no real quotes have arrived. With viableMaterials in hand,
  // totalCards > 0 and we render the optimistic skeleton list below.
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
        <PickerNotice
          title="Couldn't reach every manufacturer in time"
          description="Quotes are slow to come back right now. Retrying usually works within a few seconds."
          actions={
            onRetryQuotes && (
              <Button variant="secondary" onClick={onRetryQuotes}>
                Retry
              </Button>
            )
          }
        />
      );
    }
    if (materialScoped) {
      return (
        <PickerNotice
          title="No one is quoting this material right now"
          description="Specialty materials come from a handful of manufacturers, and sometimes none respond in time. Retry, or see what else works for your model."
          actions={
            <>
              {onClearScope && (
                <Button variant="secondary" onClick={onClearScope}>
                  Try a different material
                </Button>
              )}
              {onRetryQuotes && (
                <Button variant="ghost" onClick={onRetryQuotes}>
                  Retry
                </Button>
              )}
            </>
          }
        />
      );
    }
    return (
      <PickerNotice
        title="No quotes for this file"
        description="The model is probably larger than any manufacturer can print, or no one ships to the selected region. Try another Ship to region, or scale the model down."
      />
    );
  }

  const listedCount = Array.from(cardsByGroup.values())
    .flat()
    .filter(isListed).length;

  // Chips: Popular, All, then every family that still has rows.
  const chipGroups = groups.filter((g) =>
    (cardsByGroup.get(g.id) ?? []).some(isListed),
  );
  // A family can vanish once polling settles; fall back to Popular.
  const activeView =
    view === POPULAR || view === ALL || chipGroups.some((g) => g.id === view)
      ? view
      : POPULAR;
  const popularListed = popularCards.filter(isListed);
  const showPopularChip = popularListed.length > 0;
  const effectiveView =
    activeView === POPULAR && !showPopularChip ? ALL : activeView;

  const subtitle = quotesLoading
    ? "Collecting quotes. More appear as manufacturers respond."
    : `${listedCount} ${listedCount === 1 ? "material" : "materials"} can print this file.`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-base leading-6 font-semibold outline-none"
          >
            Choose a material
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
            {quotesLoading && <DottedSpinner size={13} className="shrink-0" />}
            {subtitle}
          </p>
        </div>
      </div>

      {!quotesLoading && quotesPartial && (
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          Some manufacturers didn&apos;t respond in time, so a cheaper option
          may be missing.{" "}
          {onRetryQuotes && (
            <button
              type="button"
              onClick={onRetryQuotes}
              className="cursor-pointer font-medium text-foreground underline underline-offset-2"
            >
              Retry
            </button>
          )}
        </p>
      )}

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search materials"
            aria-label="Search materials"
            className="pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
        <Select
          value={sort}
          onValueChange={(v) => v && setSort(v as MaterialSort)}
        >
          <SelectTrigger
            aria-label="Sort materials"
            className="w-auto shrink-0"
          >
            <SelectValue>
              {(value) => SORT_LABELS[(value as MaterialSort) ?? "recommended"]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {(Object.keys(SORT_LABELS) as MaterialSort[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!searchResults && (
        <div
          role="radiogroup"
          aria-label="Material family"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] lg:mx-0 lg:px-0 lg:pr-8 lg:[mask-image:linear-gradient(to_right,#000_88%,transparent)] [&::-webkit-scrollbar]:hidden"
        >
          {showPopularChip && (
            <FilterChip
              checked={effectiveView === POPULAR}
              onClick={() => setView(POPULAR)}
            >
              Popular
            </FilterChip>
          )}
          <FilterChip
            checked={effectiveView === ALL}
            onClick={() => setView(ALL)}
          >
            All
          </FilterChip>
          {chipGroups.map((g) => (
            <FilterChip
              key={g.id}
              checked={effectiveView === g.id}
              onClick={() => setView(g.id)}
            >
              {g.name}
            </FilterChip>
          ))}
        </div>
      )}

      {searchResults ? (
        searchResults.length > 0 ? (
          <MaterialList
            cards={searchResults}
            quotesLoading={quotesLoading}
            onPick={onPick}
            showGroup
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No materials match &ldquo;{query.trim()}&rdquo;.
          </p>
        )
      ) : effectiveView === POPULAR ? (
        <MaterialList
          cards={sortCards(popularListed)}
          quotesLoading={quotesLoading}
          onPick={onPick}
          showGroup
          footer={
            <ListFooterButton onClick={() => setView(ALL)}>
              See all {listedCount} materials
            </ListFooterButton>
          }
        />
      ) : effectiveView === ALL ? (
        <div className="flex flex-col gap-5">
          {chipGroups.map((g) => {
            const cards = sortCards(
              (cardsByGroup.get(g.id) ?? []).filter(isListed),
            );
            const preview = cards.slice(0, GROUP_PREVIEW_LIMIT);
            const hidden = cards.length - preview.length;
            return (
              <section key={g.id} aria-label={g.name}>
                <h3 className="mb-1 px-3 text-xs font-medium text-subtle-foreground">
                  {g.name}
                </h3>
                <MaterialList
                  cards={preview}
                  quotesLoading={quotesLoading}
                  onPick={onPick}
                  footer={
                    hidden > 0 ? (
                      <ListFooterButton onClick={() => setView(g.id)}>
                        {hidden} more {g.name.toLowerCase()}
                      </ListFooterButton>
                    ) : null
                  }
                />
              </section>
            );
          })}
        </div>
      ) : (
        <MaterialList
          cards={sortCards(
            (cardsByGroup.get(effectiveView) ?? []).filter(isListed),
          )}
          quotesLoading={quotesLoading}
          onPick={onPick}
        />
      )}
    </div>
  );
}

type MaterialSort = "recommended" | "price" | "speed";

const SORT_LABELS: Record<MaterialSort, string> = {
  recommended: "Recommended",
  price: "Lowest price",
  speed: "Fastest",
};

/** Rows shown per family in the "All" view before "N more". */
const GROUP_PREVIEW_LIMIT = 4;

function FilterChip({
  checked,
  onClick,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        checked
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ListFooterButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
    >
      {children}
      <ChevronRight size={12} />
    </button>
  );
}

function MaterialList({
  cards,
  quotesLoading,
  onPick,
  showGroup = false,
  footer,
}: {
  cards: MaterialCard[];
  quotesLoading: boolean;
  onPick: (materialId: string) => void;
  /** Show the family in the meta line — for mixed lists (Popular, search). */
  showGroup?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <div>
      <ul className="-mx-3 flex flex-col">
        {cards.map((card) => (
          <li key={card.materialId}>
            <MaterialRow
              card={card}
              quotesLoading={quotesLoading}
              onPick={onPick}
              showGroup={showGroup}
            />
          </li>
        ))}
      </ul>
      {footer && <div className="-mx-3">{footer}</div>}
    </div>
  );
}

function formatLeadTime(fast: number | null, slow: number | null) {
  if (fast === null || slow === null) return null;
  return fast === slow ? `${fast} days` : `${fast}–${slow} days`;
}

function MaterialRow({
  card,
  quotesLoading,
  onPick,
  showGroup,
}: {
  card: MaterialCard;
  quotesLoading: boolean;
  onPick: (materialId: string) => void;
  showGroup: boolean;
}) {
  const priced = card.cheapest !== null;
  // Three states for the price slot:
  //   - priced: real quote arrived, render the price
  //   - pending: still polling, no quote yet — render a skeleton
  //   - unavailable: polling done, no quote came back — render "—"
  // The row stays mounted while polling so the list never shifts.
  const pending = !priced && quotesLoading;
  const lead = formatLeadTime(card.fastestFast, card.fastestSlow);
  const meta = [showGroup ? card.materialGroupName : null, priced ? lead : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      data-slot="material-option"
      onClick={() => onPick(card.materialId)}
      disabled={!priced}
      aria-busy={pending}
      // w-full + min-w-0 keep the row inside its column even when a
      // long material name (e.g. "BASF® Ultrafuse 17-4 PH Steel")
      // would otherwise push min-content past the viewport — iOS
      // Safari then auto-zooms the layout and clips the right edge.
      className="group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 enabled:hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
    >
      <div className="relative size-10 shrink-0 overflow-hidden rounded-[10px] bg-muted">
        {card.materialImage && (
          <Image
            src={resolveCatalogImage(card.materialImage)}
            alt=""
            fill
            sizes="40px"
            className="object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{card.materialName}</p>
        {meta && (
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
            {meta}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {priced ? (
          <p className="text-sm tabular-nums">
            <span className="text-[13px] text-muted-foreground">from </span>
            <span className="font-medium">${card.cheapest!.toFixed(2)}</span>
          </p>
        ) : pending ? (
          <>
            <Skeleton className="h-4 w-14" aria-hidden="true" />
            <span className="sr-only">price pending</span>
          </>
        ) : (
          <p className="text-sm text-muted-foreground tabular-nums">
            <span aria-hidden="true">—</span>
            <span className="sr-only">no vendor quote available</span>
          </p>
        )}
        <ChevronRight
          size={14}
          className={cn(
            "text-subtle-foreground transition-colors",
            priced ? "group-hover:text-foreground" : "opacity-0",
          )}
        />
      </div>
    </button>
  );
}

function PickerNotice({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div role="status" className="flex flex-col items-start gap-3 py-6">
      <div>
        <p className="text-base leading-6 font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/**
 * First paint while we wait for the initial poll snapshot: the step's
 * header plus row skeletons shaped like the list that's coming.
 */
function MaterialStepLoading() {
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-label="Collecting quotes"
    >
      <div>
        <h2 className="text-base leading-6 font-semibold">Choose a material</h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
          <DottedSpinner size={13} className="shrink-0" />
          Collecting quotes from manufacturers worldwide.
        </p>
      </div>
      <Skeleton className="h-9 w-full rounded-[10px]" />
      <div className="flex flex-col">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-10 rounded-[10px]" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}
