import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Page } from "@/components/ui/page";
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
        <Skeleton className="absolute inset-0 rounded-xl" />
      </div>
      <CardContent className={FILE_CARD_BODY_CLASS}>
        <Skeleton
          className={`h-3.5 ${TITLE_WIDTHS[i % TITLE_WIDTHS.length]}`}
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-full" />
          <Skeleton
            className={`h-2.5 ${CREATOR_WIDTHS[i % CREATOR_WIDTHS.length]}`}
          />
        </div>
        <div className="mt-2">
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
    <section className="flex flex-col gap-4">
      <Skeleton className={`h-4 ${titleWidth}`} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: count }).map((_, i) => (
          <FileCardSkeleton key={i} i={i + offset} />
        ))}
      </div>
    </section>
  );
}

/**
 * Mirrors the idle browse layout in app/(app)/files/(browse)/page.tsx:
 *   - title + one-line description
 *   - BrowseSearchBar (max-w-xl, 40px pill)
 *   - CategoryFilterBar chip row (32px pills)
 *   - Files then Projects sections with the shared FileCard chrome
 */
export default function FilesLoading() {
  return (
    <Page width="wide" className="gap-10">
      <div className="flex flex-col gap-5">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-1.5 h-4 w-80 max-w-full" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full max-w-xl rounded-full" />
          <div className="flex gap-2 overflow-hidden py-1">
            {CHIP_WIDTHS.map((w, i) => (
              <Skeleton key={i} className={`h-8 shrink-0 rounded-full ${w}`} />
            ))}
          </div>
        </div>
      </div>

      <SectionSkeleton titleWidth="w-12" count={10} />
      <SectionSkeleton titleWidth="w-16" count={5} offset={10} />
    </Page>
  );
}

const CHIP_WIDTHS = ["w-12", "w-28", "w-28", "w-24", "w-32", "w-24", "w-28", "w-20"];
