import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

// Width presets so the skeleton grid doesn't read as uniform bars.
const NAME_WIDTHS = [
  "w-28",
  "w-36",
  "w-24",
  "w-32",
  "w-40",
  "w-28",
  "w-32",
  "w-24",
];
const DESC_WIDTHS_A = [
  "w-full",
  "w-11/12",
  "w-full",
  "w-4/5",
  "w-11/12",
  "w-full",
  "w-10/12",
  "w-full",
];
const DESC_WIDTHS_B = [
  "w-3/4",
  "w-2/3",
  "w-5/6",
  "w-3/5",
  "w-4/5",
  "w-2/3",
  "w-3/4",
  "w-1/2",
];

/**
 * Mirrors app/(app)/materials/page.tsx + CatalogBrowser — title,
 * filter chip row, one collapsible section with a grid of cards
 * whose layout matches `CatalogMaterialCard` exactly (p-1 card,
 * rounded-lg aspect-[4/3] image, truncated name, two-line
 * description, tag row).
 */
export default function MaterialsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      <div className="space-y-6">
        {/* Filter chip row — matches Button sm chips in CatalogBrowser */}
        <div className="flex flex-wrap gap-2">
          {["w-12", "w-20", "w-28", "w-20", "w-16", "w-24", "w-20"].map(
            (w, i) => (
              <Skeleton key={i} className={`h-8 rounded-full ${w}`} />
            )
          )}
        </div>

        {/* One collapsible group section */}
        <div className="space-y-4">
          <section>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-3 w-3 rounded-sm" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Card key={i} className="gap-0 p-1 overflow-hidden">
                  {/* 4:3 rounded image area */}
                  <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                  <CardContent className="p-3">
                    {/* Material name (truncated in real card) */}
                    <Skeleton
                      className={`h-3.5 ${NAME_WIDTHS[i % NAME_WIDTHS.length]}`}
                    />
                    {/* Two-line description */}
                    <div className="mt-1.5 space-y-1">
                      <Skeleton
                        className={`h-2.5 ${DESC_WIDTHS_A[i % DESC_WIDTHS_A.length]}`}
                      />
                      <Skeleton
                        className={`h-2.5 ${DESC_WIDTHS_B[i % DESC_WIDTHS_B.length]}`}
                      />
                    </div>
                    {/* Tag chip row (3 chips) */}
                    <div className="mt-3 flex gap-1">
                      <Skeleton className="h-4 w-12 rounded-md" />
                      <Skeleton className="h-4 w-16 rounded-md" />
                      <Skeleton className="h-4 w-14 rounded-md" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
