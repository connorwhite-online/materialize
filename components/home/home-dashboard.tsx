import { Suspense } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/ui/page";
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
 * Authed home: title + quick creates, the upload dropzone (the one
 * primary action), in-progress orders (if any; attention-needed first)
 * as rows, recent files (if any), then the full library. Not a jump-off
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
    <Page className="gap-10">
      <div className="flex flex-col gap-4">
        {/* Title row with the two secondary creates at natural width on
            the right; the dropzone below is the page's one primary
            action. The pair used to be a full-width 50/50 button bar
            under the dropzone, competing with it. */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl leading-7 font-semibold">Home</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              render={<Link href="/projects/new" />}
            >
              <PlusIcon />
              Project
            </Button>
            <Button
              variant="secondary"
              size="sm"
              render={<Link href="/collections/new" />}
            >
              <PlusIcon />
              Collection
            </Button>
          </div>
        </div>

        <section>
          <h2 className="sr-only">Add to your library</h2>
          <HomeDropzone showCreateActions={false} />
        </section>
      </div>

      <Suspense fallback={null}>
        <HomePendingOrders userId={userId} />
      </Suspense>

      <Suspense fallback={null}>
        <HomeRecentFiles userId={userId} />
      </Suspense>

      <Suspense fallback={null}>
        <LibraryTab userId={userId} isOwner compact />
      </Suspense>
    </Page>
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
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm leading-5 font-semibold">Orders</h2>
        <Link
          href="/dashboard/orders"
          className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          All orders
        </Link>
      </div>
      <div className="flex flex-col">
        {pending.map((order) => (
          <PendingOrderTile key={order.id} order={order} />
        ))}
      </div>
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
    <section className="flex flex-col gap-3">
      <h2 className="text-sm leading-5 font-semibold">Recent files</h2>
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
