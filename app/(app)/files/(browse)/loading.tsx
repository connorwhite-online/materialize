import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  FILE_CARD_BODY_CLASS,
  FILE_CARD_SHELL_CLASS,
  FILE_CARD_WELL_CLASS,
} from "@/components/files/file-card";

const TITLE_WIDTHS = ["w-3/4", "w-2/3", "w-4/5", "w-1/2", "w-3/5"];
const CREATOR_WIDTHS = ["w-20", "w-16", "w-24", "w-14", "w-28"];

/**
 * One tile matching discover FileCard chrome: inset square well,
 * title, creator (avatar + name), downloads meta. Price lives as an
 * overlay badge on the well in the real card — omitted here so the
 * body doesn't invent a price/downloads row the loaded grid never has.
 */
function FileCardSkeleton({ i }: { i: number }) {
  return (
    <Card className={FILE_CARD_SHELL_CLASS}>
      <div className={FILE_CARD_WELL_CLASS}>
        <Skeleton className="absolute inset-0 rounded-lg" />
      </div>
      <CardContent className={FILE_CARD_BODY_CLASS}>
        <Skeleton
          className={`h-3.5 ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]}`}
        />
        <div className="mt-0.5 flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-full" />
          <Skeleton
            className={`h-2.5 ${CREATOR_WIDTHS[i % CREATOR_WIDTHS.length]}`}
          />
        </div>
        <div className="mt-1.5">
          <Skeleton className="h-2.5 w-10" />
        </div>
      </CardContent>
    </Card>
  );
}

function SectionSkeleton({
  titleWidth,
  count,
  offset = 0,
}: {
  titleWidth: string;
  count: number;
  offset?: number;
}) {
  return (
    <section className="mt-10">
      <Skeleton className={`mb-4 h-3.5 ${titleWidth}`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: count }).map((_, i) => (
          <FileCardSkeleton key={i} i={i + offset} />
        ))}
      </div>
    </section>
  );
}

/**
 * Mirrors the idle browse layout in app/(app)/files/(browse)/page.tsx:
 *   - centered BrowseSearchBar (max-w-2xl, rounded-3xl, p-1 + 38px row)
 *   - CategoryFilterBar Select (size sm → h-9, min-w-48)
 *   - Projects section + Files section with the shared FileCard chrome
 */
export default function FilesLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex justify-center">
        {/* p-1 + h-[38px] input row ≈ 46px; rounded-3xl matches the bar */}
        <Skeleton className="h-[46px] w-full max-w-2xl rounded-3xl" />
      </div>
      <div className="mt-4 flex">
        <Skeleton className="h-9 w-48 rounded-xl" />
      </div>

      <SectionSkeleton titleWidth="w-16" count={4} />
      <SectionSkeleton titleWidth="w-12" count={10} offset={4} />
    </div>
  );
}
