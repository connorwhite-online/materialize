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
 * Materials browse UI. Top-level filter chip row narrows to a
 * specific material group; each group renders as a collapsible
 * section (chevron + name + count) so the user can fold away
 * families they aren't interested in.
 */
export function CatalogBrowser({ groups }: CatalogBrowserProps) {
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const visibleGroups = useMemo(
    () => (activeGroup ? groups.filter((g) => g.id === activeGroup) : groups),
    [groups, activeGroup]
  );

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
            {groups.reduce((s, g) => s + g.materials.length, 0)}
          </span>
        </Button>
        {groups.map((g) => (
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
