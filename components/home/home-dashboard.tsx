import { HomeDropzone } from "@/components/home/home-dropzone";
import { FeatheredCarousel } from "@/components/home/feathered-carousel";
import { PendingOrderTile } from "@/components/home/pending-order-tile";
import { LibraryTab } from "@/components/profile/library-tab";
import {
  FileCard,
  formatFileDimensions,
} from "@/components/files/file-card";
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
              <FileCard
                key={tile.fileAssetId}
                compact
                href={`/print/${tile.fileAssetId}`}
                title={tile.name}
                thumbnailUrl={tile.thumbnailUrl}
                // Same subtitle line as LibraryFileCard so Recent and
                // the compact Files strip share one card height/meta.
                subtitle={formatFileDimensions(tile.dimensions) ?? "—"}
                placeholder={
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                    .{tile.format}
                  </span>
                }
              />
            ))}
          </FeatheredCarousel>
        </section>
      )}

      <LibraryTab userId={userId} isOwner compact />
    </div>
  );
}
