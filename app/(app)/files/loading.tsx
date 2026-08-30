import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  FILE_CARD_BODY_CLASS,
  FILE_CARD_SHELL_CLASS,
  FILE_CARD_WELL_CLASS,
} from "@/components/files/file-card";

/**
 * Mirrors app/(app)/files/page.tsx — title + search row, then the
 * same FileCard chrome (inset square well + title/meta) as the
 * discover grid.
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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Card key={i} className={FILE_CARD_SHELL_CLASS}>
            <Skeleton className={FILE_CARD_WELL_CLASS} />
            <CardContent className={FILE_CARD_BODY_CLASS}>
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
