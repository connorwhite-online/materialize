"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";
import { SearchIcon } from "@/components/icons/oai";
import { cn } from "@/lib/utils";
import {
  CatalogMaterialCard,
  type BrowseMaterial,
  type BrowseMaterialGroup,
} from "./catalog-material-card";

const ALL = "all";

/** Dense browse grid: two-up on phones, scaling up on wider viewports. */
const MATERIAL_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

/**
 * How many materials each family shows in the All view before its
 * "Show all" link. Ten is two full rows at xl (5 columns) and keeps the
 * page to a scannable overview of every family instead of a 200-card
 * wall (it measured ~13,600px tall on desktop when every family was
 * expanded). The family chip, or the section's "Show all", opens the
 * rest.
 */
const PREVIEW_PER_GROUP = 10;

/**
 * How many materials to surface in the "Popular" section at the top
 * of the All view. CraftCloud's first sortIndex slots are exactly the
 * canonical shortlist (PLA, SLS Nylon, 316L Steel, …).
 */
const POPULAR_LIMIT = 10;

/**
 * Capped shelves show exactly two rows at every breakpoint (2, 3, 4 and
 * 5 columns): items past the second row of the current grid are hidden
 * with CSS, so phones get 4 per family instead of a five-row column.
 */
/** Hide "Show all" at the breakpoints where two rows already fit them all. */
function showAllClass(count: number) {
  if (count > PREVIEW_PER_GROUP) return undefined;
  if (count > 8) return "xl:hidden";
  if (count > 6) return "lg:hidden";
  return "md:hidden";
}

function twoRowClass(index: number) {
  if (index < 4) return undefined;
  if (index < 6) return "hidden md:block";
  if (index < 8) return "hidden lg:block";
  return "hidden xl:block";
}

interface CatalogBrowserProps {
  groups: BrowseMaterialGroup[];
}

/**
 * Materials browse UI: a search field and a row of family chips (the
 * same chip pattern as /files categories) over a sectioned grid.
 *
 * - All (default): Popular, then each family capped at
 *   PREVIEW_PER_GROUP with a "Show all N" that switches to that family.
 * - A family chip: that family's full grid.
 * - Typing: one flat grid of name/description matches across every
 *   family, which is the fastest path when you already know the name.
 *
 * Group ordering and the Popular shortlist key off CraftCloud's
 * editorial sortIndex (lower = more popular), the same approach as the
 * print picker so both views agree on what most people want.
 */
export function CatalogBrowser({ groups }: CatalogBrowserProps) {
  const [activeGroup, setActiveGroup] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  const { sortedGroups, popularMaterials } = useMemo(() => {
    const sortIndexOf = (m: BrowseMaterial) => m.sortIndex ?? 9999;

    const sortedGroups = groups
      .map((g) => ({
        ...g,
        materials: [...g.materials].sort(
          (a, b) => sortIndexOf(a) - sortIndexOf(b)
        ),
      }))
      // Families sort by their best (lowest) sortIndex: Standard
      // Plastics first because of PLA, Nylons next because of SLS PA12.
      .sort((a, b) => {
        const best = (g: BrowseMaterialGroup) =>
          g.materials.reduce((min, m) => Math.min(min, sortIndexOf(m)), Infinity);
        return best(a) - best(b);
      });

    const popularMaterials = sortedGroups
      .flatMap((g) => g.materials.map((m) => ({ material: m, group: g })))
      .sort((a, b) => sortIndexOf(a.material) - sortIndexOf(b.material))
      .slice(0, POPULAR_LIMIT);

    return { sortedGroups, popularMaterials };
  }, [groups]);

  const total = sortedGroups.reduce((s, g) => s + g.materials.length, 0);
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return [];
    return sortedGroups.flatMap((g) =>
      g.materials
        .filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            g.name.toLowerCase().includes(q) ||
            (m.descriptionShort ?? "").toLowerCase().includes(q)
        )
        .map((m) => ({ material: m, group: g }))
    );
  }, [q, sortedGroups]);

  const chips = [
    { id: ALL, label: "All", count: total },
    ...sortedGroups.map((g) => ({
      id: g.id,
      label: g.name,
      count: g.materials.length,
    })),
  ];

  const openGroup = (id: string) => {
    setActiveGroup(id);
    setQuery("");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const visibleGroups =
    activeGroup === ALL
      ? sortedGroups
      : sortedGroups.filter((g) => g.id === activeGroup);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <form
          role="search"
          className="relative w-full max-w-xl"
          onSubmit={(e) => e.preventDefault()}
        >
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
            aria-label="Search materials"
            placeholder={`Search ${total} materials`}
            className="h-10 w-full min-w-0 rounded-full border border-input bg-background pr-4 pl-10 field-text outline-none transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-subtle-foreground hover:border-foreground/25 focus-visible:border-ring focus-visible:shadow-input-focus md:text-sm [&::-webkit-search-decoration]:hidden"
          />
        </form>

        <div
          role="tablist"
          aria-label="Material families"
          className="-mx-4 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-32px),transparent)] sm:mx-0 sm:[mask-image:linear-gradient(to_right,black_calc(100%-48px),transparent)]"
        >
          <div className="flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden">
            {chips.map((c) => {
              const isActive = !q && c.id === activeGroup;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => openGroup(c.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    isActive
                      ? "bg-foreground font-medium text-background"
                      : "bg-secondary text-foreground hover:bg-foreground/[0.09]"
                  )}
                >
                  {c.label}
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      isActive ? "text-background/60" : "text-subtle-foreground"
                    )}
                  >
                    {c.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {q ? (
        matches.length === 0 ? (
          <EmptyState
            icon={<SearchIcon />}
            title={<>No materials match &ldquo;{query.trim()}&rdquo;</>}
            description="Try a family name like nylon or steel, or a shorter search."
            action={
              <Button variant="secondary" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <GroupSection name="Results" count={matches.length}>
            <div className={MATERIAL_GRID}>
              {matches.map(({ material, group }) => (
                <CatalogMaterialCard
                  key={material.id}
                  material={material}
                  group={group}
                />
              ))}
            </div>
          </GroupSection>
        )
      ) : (
        <>
          {activeGroup === ALL && popularMaterials.length > 0 && (
            <GroupSection name="Popular">
              <div className={MATERIAL_GRID}>
                {popularMaterials.map(({ material, group }, i) => (
                  <div key={material.id} className={twoRowClass(i)}>
                    <CatalogMaterialCard material={material} group={group} />
                  </div>
                ))}
              </div>
            </GroupSection>
          )}
          {visibleGroups.map((g) => {
            // Show-all appears whenever anything is hidden, which on a
            // phone (two rows = 4) is any family with more than four.
            const capped = activeGroup === ALL && g.materials.length > 4;
            const shown = capped
              ? g.materials.slice(0, PREVIEW_PER_GROUP)
              : g.materials;
            return (
              <GroupSection
                key={g.id}
                name={g.name}
                count={g.materials.length}
                action={
                  capped ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "-mr-3 text-muted-foreground",
                        showAllClass(g.materials.length)
                      )}
                      onClick={() => openGroup(g.id)}
                    >
                      Show all {g.materials.length}
                    </Button>
                  ) : null
                }
              >
                <div className={MATERIAL_GRID}>
                  {shown.map((material, i) => (
                    <div
                      key={material.id}
                      className={capped ? twoRowClass(i) : undefined}
                    >
                      <CatalogMaterialCard material={material} group={g} />
                    </div>
                  ))}
                </div>
              </GroupSection>
            );
          })}
        </>
      )}
    </div>
  );
}

function GroupSection({
  name,
  count,
  action,
  children,
}: {
  name: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="flex items-baseline gap-2 text-base leading-6 font-semibold">
          {name}
          {count != null && (
            <span className="text-sm font-normal text-subtle-foreground tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
