import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Mirrors app/(app)/print/[fileAssetId]/page.tsx — title + subtitle,
 * optional recommendation row, then the two-column QuoteConfigurator
 * layout (material selector on the left, price + cta sidebar on the right).
 */
export default function PrintLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Title + subtitle */}
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-56" />

      {/* Creator recommendation row */}
      <div className="mt-4 flex items-center gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>

      {/* QuoteConfigurator: two-column grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Material selector column */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-3 w-64" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Price + checkout sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-14" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-14" />
              </div>
              <div className="h-px w-full bg-border" />
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="mt-2 h-9 w-full rounded-lg" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
