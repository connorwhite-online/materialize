import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  FILE_CARD_BODY_CLASS,
  FILE_CARD_SHELL_CLASS,
  FILE_CARD_WELL_CLASS,
} from "@/components/files/file-card";

/**
 * Mirrors app/(app)/collections/[slug]/page.tsx — title + description
 * + creator/count, then the shared FileCard chrome.
 */
export default function CollectionLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        <Skeleton className="mt-2 h-3 w-40" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Card key={i} className={FILE_CARD_SHELL_CLASS}>
            <Skeleton className={FILE_CARD_WELL_CLASS} />
            <CardContent className={FILE_CARD_BODY_CLASS}>
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="mt-1 h-2.5 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
