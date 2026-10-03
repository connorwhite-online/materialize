import { Suspense } from "react";
import { HomeDropzone } from "@/components/home/home-dropzone";
import { FeatheredCarousel } from "@/components/home/feathered-carousel";
import { PendingOrderTile } from "@/components/home/pending-order-tile";
import { LibraryTab } from "@/components/profile/library-tab";
import {
  FileCard,
  fileCardOwnedSubtitle,
} from "@/components/files/file-card";
import { loadPendingOrders } from "@/lib/dashboard/pending-orders";
import { loadLibraryTiles } from "@/lib/print/library-tiles";
import { logError } from "@/lib/logger";

const RECENT_MAX = 12;

/**
 * Authed home: in-progress orders (if any; attention-needed first),
 * upload, recent files (if any), then the full library. Not a jump-off
 * to other routes — those sections live on this page.
 *
 * Every data section streams behind its own Suspense boundary. This is
 * the page a home-screen app opens cold, and it used to await every
 * query (orders, tiles, then LibraryTab's two query waves) before
 * sending a single byte — a blank screen under the splash for the whole
 * chain. Now the shell and dropzone paint immediately and each section
 * fills in as its own query lands.
 */
export function HomeDashboard({ userId }: { userId: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 sm:py-12">
      <h1 className="sr-only">Home</h1>

      <Suspense fallback={null}>
        <HomePendingOrders userId={userId} />
      </Suspense>

      <section>
        <h2 className="sr-only">Add to your library</h2>
        <HomeDropzone />
      </section>

      <Suspense fallback={null}>
        <HomeRecentFiles userId={userId} />
      </Suspense>

      <Suspense fallback={null}>
        <LibraryTab userId={userId} isOwner compact />
      </Suspense>
    </div>
  );
}

export async function HomePendingOrders({ userId }: { userId: string }) {
  let pending = [] as Awaited<ReturnType<typeof loadPendingOrders>>;
  try {
    pending = await loadPendingOrders(userId);
  } catch (err) {
    console.error("[home-dashboard] orders load failed:", err);
    logError(
      "home-dashboard.load",
      new Error("Authed home orders failed to load")
    );
  }
  if (pending.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">Orders</h2>
      <FeatheredCarousel>
        {pending.map((order) => (
          <PendingOrderTile key={order.id} order={order} />
        ))}
      </FeatheredCarousel>
    </section>
  );
}

export async function HomeRecentFiles({ userId }: { userId: string }) {
  let tiles = [] as Awaited<ReturnType<typeof loadLibraryTiles>>;
  try {
    tiles = await loadLibraryTiles(userId);
  } catch (err) {
    console.error("[home-dashboard] recent files load failed:", err);
    logError(
      "home-dashboard.load",
      new Error("Authed home recent files failed to load")
    );
  }

  const recent = tiles.slice(0, RECENT_MAX);
  if (recent.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">Recent files</h2>
      <FeatheredCarousel>
        {recent.map((tile) => (
          <FileCard
            key={tile.fileAssetId}
            compact
            // Same destination as LibraryFileCard — print from the
            // listing, not by skipping it (CON-32).
            href={`/files/${tile.slug}`}
            title={tile.name}
            thumbnailUrl={tile.thumbnailUrl}
            // Same owned subtitle as LibraryFileCard (file size).
            subtitle={fileCardOwnedSubtitle(tile.fileSizeBytes)}
            placeholder={
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                .{tile.format}
              </span>
            }
          />
        ))}
      </FeatheredCarousel>
    </section>
  );
}
