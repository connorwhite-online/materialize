import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/(app)/materials/[slug]/page.tsx: hero (image left; family
 * link, title, tags, description, CTA right), three unboxed spec
 * sections of hairline rows, then the finishes grid.
 */
export default function MaterialDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 pt-6 pb-16 sm:pt-10">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:gap-12">
        <Skeleton className="aspect-[4/3] w-full rounded-2xl md:aspect-square" />

        <div className="flex flex-col gap-5 md:py-2">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <div className="mt-1 flex gap-1.5">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
          <Skeleton className="h-10 w-60 rounded-full" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <div className="border-t border-border">
              {Array.from({ length: 4 }).map((_, j) => (
                <div
                  key={j}
                  className="flex items-center justify-between gap-4 border-b border-border py-3"
                >
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-20" />
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[4/3] w-full rounded-xl" />
              <Skeleton className="mt-2.5 h-3.5 w-24" />
              <Skeleton className="mt-1.5 h-2.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
