import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Mirrors app/(app)/materials/[slug]/page.tsx — hero with square
 * image + badges/title/description/CTA, then two property cards,
 * then an available-finishes grid, then a back link.
 */
export default function MaterialDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Hero */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Skeleton className="aspect-square w-full rounded-xl" />

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-14 rounded-md" />
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="h-4 w-16 rounded-md" />
          </div>
          <Skeleton className="h-9 w-3/4" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <Skeleton className="mt-6 h-10 w-52 rounded-full" />
        </div>
      </div>

      {/* Property cards */}
      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Array.from({ length: 5 }).map((_, j) => (
                <div
                  key={j}
                  className="flex items-baseline justify-between gap-4"
                >
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Available finishes */}
      <div className="mt-12">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-3 w-80 max-w-full" />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="gap-0 py-0 overflow-hidden">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-12" />
                </div>
                <Skeleton className="mt-2 h-2.5 w-full" />
                <Skeleton className="mt-1 h-2.5 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
    </div>
  );
}
