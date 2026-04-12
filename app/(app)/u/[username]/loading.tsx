import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Mirrors app/(app)/u/[username]/page.tsx — avatar + name header,
 * tabs row, then the default Library tab content: one collection
 * section (rounded panel with chevron + title + count chip + file
 * grid) followed by the uncollected grid panel.
 */
export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Profile header */}
      <div className="flex items-start gap-6">
        <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Skeleton className="h-7 w-48" />
              <Skeleton className="mt-2 h-4 w-32" />
            </div>
            <Skeleton className="h-7 w-20 rounded-lg" />
          </div>
          <Skeleton className="mt-3 h-4 w-full max-w-lg" />
          <div className="mt-3 flex gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </div>

      {/* Separator */}
      <div className="my-6 h-px w-full bg-border" />

      {/* Tab strip */}
      <div className="border-b border-border">
        <div className="flex gap-1 -mb-px">
          <div className="relative px-4 py-2.5">
            <Skeleton className="h-4 w-16" />
            <div className="absolute inset-x-4 bottom-0 h-0.5 bg-foreground" />
          </div>
          <div className="px-4 py-2.5">
            <Skeleton className="h-4 w-14" />
          </div>
          <div className="px-4 py-2.5">
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </div>

      {/* Library content */}
      <div className="mt-6 space-y-6">
        {/* Owner stats + upload button row */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>

        {/* Collection panel */}
        <section className="rounded-2xl bg-muted/50 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-6 w-40" />
              <Skeleton className="ml-4 h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-square w-full rounded-none" />
                <CardContent className="p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-1 h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Uncollected grid panel */}
        <div className="rounded-2xl bg-muted/50 p-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-square w-full rounded-none" />
                <CardContent className="p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-1 h-3 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
