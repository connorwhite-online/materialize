import { Skeleton } from "@/components/ui/skeleton";
import { Page } from "@/components/ui/page";

/**
 * Mirrors order-detail-view.tsx: back link + header (eyebrow, title,
 * meta | status badge), then the part preview on the left and the
 * status / receipt / details column on the right.
 */
export default function OrderDetailLoading() {
  return (
    <Page className="max-w-5xl gap-6">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-16" />
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <Skeleton className="aspect-[4/3] w-full rounded-2xl" />
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      </div>
    </Page>
  );
}
