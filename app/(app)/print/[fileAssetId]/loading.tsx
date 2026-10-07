import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/(app)/print/[fileAssetId]/page.tsx — the file header,
 * then QuoteConfigurator's two columns: the part and its inputs on the
 * left, the material list on the right. Same tracks, so nothing moves
 * when the real page streams in.
 */
export default function PrintLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:py-10">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-[10px]" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
        <div className="flex flex-col gap-5">
          <Skeleton className="aspect-[16/10] w-full rounded-2xl lg:aspect-[3/2]" />
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 sm:max-w-md">
            <Skeleton className="h-9 rounded-[10px]" />
            <Skeleton className="h-9 rounded-[10px]" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-full rounded-[10px]" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <Skeleton className="size-10 rounded-[10px]" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
