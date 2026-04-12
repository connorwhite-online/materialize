import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Mirrors app/(app)/materials/[slug]/page.tsx — max-w-4xl,
 * two-column hero (swatch square + metadata column), then a
 * two-card grid (Properties + Print Constraints), then a
 * "back to all materials" link.
 */
export default function MaterialDetailLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Hero */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Swatch */}
        <Skeleton className="aspect-square w-full rounded-xl" />

        {/* Metadata column */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-9 w-3/4" />
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
          <Skeleton className="mt-6 h-10 w-48 rounded-lg" />
        </div>
      </div>

      {/* Properties + Constraints cards */}
      <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Properties */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="mb-1 flex justify-between">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Skeleton key={j} className="h-2 flex-1 rounded-full" />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Constraints */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Skeleton className="mb-1 h-3 w-32" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="h-px w-full bg-border" />
            <div>
              <Skeleton className="mb-1 h-3 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="h-px w-full bg-border" />
            <div>
              <Skeleton className="mb-1 h-3 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8">
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
    </div>
  );
}
