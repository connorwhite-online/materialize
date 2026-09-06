import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/(app)/files/[slug]/page.tsx — 4:3 preview over info
 * on mobile, 3fr/2fr on md+, then description + photo row. Kept
 * here (not on the parent /files segment) so a file URL never
 * paints the browse-grid skeleton. The parent browse fallback lives
 * in files/(browse)/loading.tsx so Next cannot wrap this route.
 */
export default function FileDetailLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-col gap-8">
        {/* Hero — 3D preview left, file info right on md+ */}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-[3fr_2fr] md:items-start md:gap-8">
          <div>
            <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-muted/40 to-muted/10">
              <Skeleton className="h-full w-full rounded-none" />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <Skeleton className="h-8 w-3/4" />
              <div className="mt-2 flex w-fit items-center gap-1.5">
                <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="mt-3 h-4 w-52" />
              <div className="mt-3">
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>

            <div className="flex gap-2.5">
              <Skeleton className="h-12 min-w-0 flex-1 rounded-lg" />
              <Skeleton className="h-12 min-w-0 flex-1 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>

          <div className="space-y-2">
            <Skeleton className="h-4 w-14" />
            <div className="flex gap-2 overflow-hidden">
              {[...Array(4)].map((_, i) => (
                <Skeleton
                  key={i}
                  className="aspect-square w-32 shrink-0 rounded-xl sm:w-40"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
