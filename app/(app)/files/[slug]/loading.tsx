import { Skeleton } from "@/components/ui/skeleton";

export default function FileDetailLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-col gap-8">
        {/* Hero — 3D preview left, info right (mirrors md:grid in the real page) */}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-[3fr_2fr] md:items-start md:gap-8">
          <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-1/2 mt-1" />
            </div>
            <div className="space-y-2 mt-2">
              <Skeleton className="h-9 w-full rounded-lg" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>

        {/* Photos */}
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="aspect-square w-32 shrink-0 rounded-xl sm:w-40" />
          ))}
        </div>
      </div>
    </div>
  );
}
