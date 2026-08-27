import Link from "next/link";
import { HomeDropzone } from "@/components/home/home-dropzone";
import { FeatheredCarousel } from "@/components/home/feathered-carousel";
import { PendingOrderTile } from "@/components/home/pending-order-tile";
import { LibraryTab } from "@/components/profile/library-tab";
import { Card, CardContent } from "@/components/ui/card";
import { loadPendingOrders } from "@/lib/dashboard/pending-orders";
import { loadLibraryTiles } from "@/lib/print/library-tiles";
import { logError } from "@/lib/logger";

const RECENT_MAX = 12;

/**
 * Authed home: pending orders (if any), upload, recent files (if any),
 * then the full library. Not a jump-off to other routes — those
 * sections live on this page.
 */
export async function HomeDashboard({ userId }: { userId: string }) {
  let pending = [] as Awaited<ReturnType<typeof loadPendingOrders>>;
  let tiles = [] as Awaited<ReturnType<typeof loadLibraryTiles>>;
  try {
    [pending, tiles] = await Promise.all([
      loadPendingOrders(userId),
      loadLibraryTiles(userId),
    ]);
  } catch (err) {
    console.error("[home-dashboard] load failed:", err);
    logError(
      "home-dashboard.load",
      new Error("Authed home carousels failed to load")
    );
  }

  const recent = tiles.slice(0, RECENT_MAX);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 sm:py-12">
      <h1 className="sr-only">Home</h1>

      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium">Needs attention</h2>
          <FeatheredCarousel>
            {pending.map((order) => (
              <PendingOrderTile key={order.id} order={order} />
            ))}
          </FeatheredCarousel>
        </section>
      )}

      <section>
        <h2 className="sr-only">Add to your library</h2>
        <HomeDropzone />
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium">Recent files</h2>
          <FeatheredCarousel>
            {recent.map((tile) => (
              <Link
                key={tile.fileAssetId}
                href={`/print/${tile.fileAssetId}`}
                className="group block w-28 shrink-0"
              >
                <Card className="gap-0 overflow-hidden p-1 transition-colors hover:border-primary/30">
                  <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/30">
                    {tile.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={tile.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-wider text-muted-foreground/50">
                        .{tile.format}
                      </div>
                    )}
                  </div>
                  <CardContent className="px-2 py-2">
                    <p className="truncate text-sm font-medium transition-colors group-hover:text-primary">
                      {tile.name}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </FeatheredCarousel>
        </section>
      )}

      <section>
        <h2 className="sr-only">Library</h2>
        <LibraryTab userId={userId} isOwner compact />
      </section>
    </div>
  );
}
