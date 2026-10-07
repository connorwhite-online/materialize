import { Skeleton } from "@/components/ui/skeleton";
import { Page } from "@/components/ui/page";

// Width presets so skeleton name bars don't look uniform.
const NAME_WIDTHS = ["w-28", "w-36", "w-24", "w-32", "w-40", "w-28", "w-32", "w-24"];
const DESC_WIDTHS = ["w-3/4", "w-2/3", "w-5/6", "w-3/5", "w-4/5", "w-2/3", "w-3/4", "w-1/2"];
const CHIP_WIDTHS = ["w-14", "w-36", "w-24", "w-28", "w-32", "w-24", "w-28"];

function MaterialCardSkeleton({ i }: { i: number }) {
  return (
    <div>
      <Skeleton className="aspect-[4/3] w-full rounded-xl" />
      <div className="px-0.5 pt-2.5">
        <Skeleton className={`h-3.5 ${NAME_WIDTHS[i % NAME_WIDTHS.length]}`} />
        <Skeleton className="mt-2 h-2.5 w-full" />
        <Skeleton className={`mt-1 h-2.5 ${DESC_WIDTHS[i % DESC_WIDTHS.length]}`} />
      </div>
    </div>
  );
}

/**
 * Mirrors app/(app)/materials/page.tsx + CatalogBrowser layout:
 * title + subtitle, search field, family chip row, then the Popular
 * section's grid.
 */
export default function MaterialsLoading() {
  return (
    <Page width="wide" className="gap-6">
      <div>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-1.5 h-4 w-96 max-w-full" />
      </div>

      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full max-w-xl rounded-full" />
          <div className="flex gap-2 overflow-hidden py-1">
            {CHIP_WIDTHS.map((w, i) => (
              <Skeleton key={i} className={`h-8 shrink-0 rounded-full ${w}`} />
            ))}
          </div>
        </div>

        <section className="flex flex-col gap-4">
          <Skeleton className="h-4 w-20" />
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <MaterialCardSkeleton key={i} i={i} />
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}
