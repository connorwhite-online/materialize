import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Mirrors app/(app)/materials/page.tsx — title + description,
 * filter bar, then a 4-column responsive grid of MaterialCard
 * placeholders with swatch, name/meta, four property bars,
 * and a constraints footer.
 */
export default function MaterialsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      {/* Filter bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Material grid — matches MaterialCard layout */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            {/* Swatch (h-32) */}
            <Skeleton className="h-32 w-full rounded-none" />
            <CardContent className="p-4">
              {/* Name */}
              <Skeleton className="h-4 w-2/3" />
              {/* Category · priceRange */}
              <Skeleton className="mt-1 h-3 w-1/2" />

              {/* Four property bars */}
              <div className="mt-3 space-y-1.5">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <Skeleton className="h-2 w-12" />
                    <div className="flex flex-1 gap-0.5">
                      {Array.from({ length: 5 }).map((_, k) => (
                        <Skeleton
                          key={k}
                          className="h-1.5 flex-1 rounded-full"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Constraints row */}
              <div className="mt-3 border-t border-border pt-2">
                <Skeleton className="h-2 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
