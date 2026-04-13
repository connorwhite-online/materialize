import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Mirrors app/(app)/files/page.tsx — title + search row, then a
 * 4-column responsive grid of file cards with aspect-square
 * placeholder + name + creator + price/download row.
 */
export default function FilesLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-48 sm:w-64 rounded-lg" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="gap-0 p-1 overflow-hidden">
            <Skeleton className="aspect-square w-full rounded-lg" />
            <CardContent className="p-3">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="mt-1 h-2.5 w-1/2" />
              <div className="mt-2 flex items-center justify-between">
                <Skeleton className="h-3.5 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
