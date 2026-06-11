import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

// Width presets so skeleton name bars don't look uniform.
const NAME_WIDTHS = ["w-28", "w-36", "w-24", "w-32", "w-40", "w-28", "w-32", "w-24"];
const DESC_WIDTHS_A = ["w-full", "w-11/12", "w-full", "w-4/5", "w-11/12", "w-full", "w-10/12", "w-full"];
const DESC_WIDTHS_B = ["w-3/4", "w-2/3", "w-5/6", "w-3/5", "w-4/5", "w-2/3", "w-3/4", "w-1/2"];

function MaterialCardSkeleton({ i }: { i: number }) {
  return (
    <Card className="gap-0 p-1 overflow-hidden">
      <Skeleton className="aspect-[4/3] w-full rounded-lg" />
      <CardContent className="p-3">
        <Skeleton className={`h-3.5 ${NAME_WIDTHS[i % NAME_WIDTHS.length]}`} />
        <div className="mt-1.5 space-y-1">
          <Skeleton className={`h-2.5 ${DESC_WIDTHS_A[i % DESC_WIDTHS_A.length]}`} />
          <Skeleton className={`h-2.5 ${DESC_WIDTHS_B[i % DESC_WIDTHS_B.length]}`} />
        </div>
        <div className="mt-3 flex gap-1">
          <Skeleton className="h-4 w-12 rounded-md" />
          <Skeleton className="h-4 w-16 rounded-md" />
          <Skeleton className="h-4 w-14 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Mirrors app/(app)/materials/page.tsx + CatalogBrowser layout:
 *   - page title + subtitle
 *   - Select trigger (group filter dropdown)
 *   - "Popular" section header + 8-card grid
 *   - One collapsed group section below
 */
export default function MaterialsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Page heading */}
      <div className="mb-8">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      <div className="space-y-6">
        {/* Group filter — Select trigger, matches min-w-48 */}
        <Skeleton className="h-9 w-48 rounded-md" />

        <div className="space-y-4">
          {/* Popular section */}
          <section>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                <Skeleton className="h-3.5 w-16" />
              </div>
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <MaterialCardSkeleton key={i} i={i} />
              ))}
            </div>
          </section>

          {/* One additional group section (collapsed header only) */}
          <section>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                <Skeleton className="h-3.5 w-28" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
