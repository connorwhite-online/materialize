import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * Mirrors app/(app)/dashboard/orders/[orderId]/page.tsx — max-w-3xl,
 * header row (order number + title + filename | status badge),
 * status tracker block, two-column info grid (map + price card),
 * then material info card.
 */
export default function OrderDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-1 h-8 w-56" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      {/* Status tracker */}
      <div className="mt-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info grid */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Facility map */}
        <Card>
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <CardContent className="p-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-2 h-3 w-48" />
          </CardContent>
        </Card>

        {/* Price breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="h-px w-full bg-border" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Material info card */}
      <Card className="mt-4">
        <CardContent className="flex items-center gap-4 p-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-10" />
          </div>
        </CardContent>
      </Card>

      <Skeleton className="mt-6 h-3 w-48" />
    </div>
  );
}
