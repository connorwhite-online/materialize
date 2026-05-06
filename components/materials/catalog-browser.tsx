"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "@/components/icons/chevron-right";
import { CatalogMaterialCard } from "./catalog-material-card";
import type { CatalogMaterial, MaterialGroup } from "@/lib/craftcloud/catalog";

interface CatalogBrowserProps {
  groups: MaterialGroup[];
}

/**
 * How many materials to surface in the "Popular" section at the top
 * of the All view. Eight fills two rows of four at xl, three rows at
 * lg, four at sm — and CraftCloud's first ten sortIndex slots are
 * exactly the canonical shortlist (PLA, SLS Nylon, 316L Steel, etc.)
 * so eight gives breathing room past the obvious picks.
 */
const POPULAR_LIMIT = 8;

/**
 * Materials browse UI. Top-level filter chip row narrows to a
 * specific material group; each group renders as a collapsible
 * section (chevron + name + count) so the user can fold away
 * families they aren't interested in.
 *
 * Group ordering and the top-of-page "Popular" shortlist both key off
 * CraftCloud's editorial sortIndex (lower = more popular). Same
 * approach as the print picker so the two views stay consistent in
 * which materials they treat as "what most people want".
 */
export function CatalogBrowser({ groups }: CatalogBrowserProps) {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const { sortedGroups, popularMaterials } = useMemo(() => {
    const sortIndexOf = (m: CatalogMaterial) => m.sortIndex ?? 9999;

    // Order materials within each group by sortIndex so the most
    // common picks float to the top of the family section too.
    const sortedGroups = groups
      .map((g) => ({
        ...g,
        materials: [...g.materials].sort(
          (a, b) =>
            sortIndexOf(a as CatalogMaterial) -
            sortIndexOf(b as CatalogMaterial)
        ),
      }))
      // Then sort the groups themselves by their best (lowest)
      // sortIndex — Standard Plastics first because of PLA, Nylons
      // next because of SLS PA12, etc. Falls back to the original
      // order when two groups happen to tie on their best material.
      .sort((a, b) => {
        const bestA = a.materials.reduce(
          (min, m) => Math.min(min, sortIndexOf(m as CatalogMaterial)),
          Infinity
        );
        const bestB = b.materials.reduce(
          (min, m) => Math.min(min, sortIndexOf(m as CatalogMaterial)),
          Infinity
        );
        return bestA - bestB;
      });

    const popularMaterials = sortedGroups
      .flatMap((g) =>
        g.materials.map((m) => ({ material: m as CatalogMaterial, group: g }))
      )
      .sort(
        (a, b) => sortIndexOf(a.material) - sortIndexOf(b.material)
      )
      .slice(0, POPULAR_LIMIT);

    return { sortedGroups, popularMaterials };
  }, [groups]);

  const visibleGroups = useMemo(
    () =>
      activeGroup
        ? sortedGroups.filter((g) => g.id === activeGroup)
        : sortedGroups,
    [sortedGroups, activeGroup]
  );

  // Popular shortlist only makes sense when the user is browsing All —
  // a group filter narrows to one family and the popular block would
  // visually duplicate the first few cards of that family below.
  const showPopular = activeGroup === null && popularMaterials.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeGroup === null ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveGroup(null)}
        >
          All
          <span className="ml-1 text-xs opacity-60">
            {sortedGroups.reduce((s, g) => s + g.materials.length, 0)}
          </span>
        </Button>
        {sortedGroups.map((g) => (
          <Button
            key={g.id}
            variant={activeGroup === g.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() =>
              setActiveGroup((prev) => (prev === g.id ? null : g.id))
            }
          >
            {g.name}
            <span className="ml-1 text-xs opacity-60">
              {g.materials.length}
            </span>
          </Button>
        ))}
      </div>

      {visibleGroups.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No materials match your filters.
        </div>
      ) : (
        <div className="space-y-4">
          {showPopular && (
            <GroupSection name="Popular" count={popularMaterials.length}>
              <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {popularMaterials.map(({ material, group }) => (
                  <CatalogMaterialCard
                    key={material.id}
                    material={material}
                    group={group}
                  />
                ))}
              </div>
            </GroupSection>
          )}
          {visibleGroups.map((g) => (
            <GroupSection key={g.id} name={g.name} count={g.materials.length}>
              <div className="grid grid-cols-1 gap-4 pt-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.materials.map((material) => (
                  <CatalogMaterialCard
                    key={material.id}
                    material={material as CatalogMaterial}
                    group={g}
                  />
                ))}
              </div>
            </GroupSection>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible group wrapper — same shape as the one in
 * `material-picker/material-step.tsx`. Chevron rotates on toggle,
 * content height animates.
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
