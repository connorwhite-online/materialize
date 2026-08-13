import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { PrintPageContent } from "@/components/print/print-page-content";
import { loadLibraryTiles, type LibraryTile } from "@/lib/print/library-tiles";
import { getCheckoutModel } from "@/lib/env";
import { loadProjectPrintTiles } from "@/lib/print/project-tiles";
import { logError } from "@/lib/logger";

/**
 * The instant-quote landing page. It had no metadata, so it inherited
 * the generic site title despite being the page that answers the
 * highest-intent query we can serve: someone who wants a thing printed.
 *
 * Every variant canonicalizes back to bare `/print`. The `?material=`,
 * `?project=` and `?expand=` params only pre-seed the configurator —
 * the page's indexable content is identical across all of them, so
 * letting each combination be indexed separately would split signals
 * across near-duplicate URLs for no gain.
 */
export const metadata: Metadata = {
  title: "3D Printing Service — Upload a Model, Get an Instant Quote",
  description:
    "Upload an STL, OBJ, 3MF or STEP file and get instant 3D printing quotes from vetted manufacturers. Choose from 60+ materials including PLA, resin, nylon and metal — printed and shipped to your door, no printer required.",
  alternates: { canonical: "/print" },
  openGraph: {
    type: "website",
    title: "3D Printing Service — Upload a Model, Get an Instant Quote",
    description:
      "Upload a 3D model, compare live quotes from vetted print shops across 60+ materials, and have the finished part shipped to you.",
    url: "/print",
  },
};

export default async function PrintPage(props: {
  searchParams: Promise<{ material?: string; expand?: string; project?: string }>;
}) {
  const searchParams = await props.searchParams;
  const materialId = searchParams.material;
  const initialExpandVendorId = searchParams.expand;
  const projectSlug = searchParams.project;
  // The "Print with X" link on /materials/[slug] passes CraftCloud's
  // real material id, so we resolve it against the cached catalog
  // for the headline and then forward the same id downstream for
  // the material-step auto-skip. The catalog fetch (which can retry
  // 3x with backoff on a CraftCloud 403/429) shares no data with
  // auth(), so run them concurrently instead of paying the catalog
  // latency before auth() even starts.
  const [catalog, { userId }] = await Promise.all([
    materialId ? getCraftCloudCatalog() : Promise.resolve(null),
    auth(),
  ]);
  const material = materialId
    ? catalog?.materialById.get(materialId) ?? null
    : null;

  // Project-scoped print hub — the "Print this project" button links
  // here with `?project=<slug>`. The tile grid is seeded with the
  // project's bundled files instead of the user's personal library;
  // everything downstream (per-file configurator → cart → vendor-group
  // checkout) is unchanged. Tiles carry the project slug forward so the
  // per-file detour can route back into this hub (see the linkSuffix /
  // ?project= round-trip in print-page-content + file-asset-print-shell).
  // A bad / inaccessible slug falls through to the normal print page.
  if (projectSlug) {
    let projectCtx = null;
    try {
      projectCtx = await loadProjectPrintTiles(projectSlug, userId);
    } catch (err) {
      console.error("[print-page] loadProjectPrintTiles failed:", err);
      logError(
        "print-page.loadProjectPrintTiles",
        new Error("Project print tiles failed to load")
      );
    }
    if (projectCtx) {
      return (
        <PrintPageContent
          headline={"Print a Project"}
          subheadline="Configure each file, add it to your cart, then check out together."
          tiles={projectCtx.tiles}
          linkSuffix={`?project=${encodeURIComponent(projectCtx.projectSlug)}`}
          isProjectMode
          projectMeta={{
            name: projectCtx.projectName,
            thumbnailUrl: projectCtx.projectThumbnailUrl,
            author: projectCtx.author,
            fileCount: projectCtx.tiles.length,
            totalFileSizeBytes: projectCtx.totalFileSizeBytes,
          }}
          initialExpandVendorId={initialExpandVendorId}
          checkoutModel={getCheckoutModel()}
        />
      );
    }
  }

  // The saved-library grid is a convenience, not load-bearing — you can
  // always upload + quote a fresh file. A DB hiccup loading it (e.g. a
  // reaped Neon connection that outlives the single retry in
  // loadLibraryTiles) must NOT take down the whole Print page, which is
  // the revenue hot path. Degrade to an empty grid.
  //
  // We capture the failure under a clean, application-named error so it
  // stays visible in Sentry: the raw driver error ("Connection
  // closed"/ECONNRESET/…) matches the connection-noise `ignoreErrors`
  // filter in sentry.server.config.ts — tuned for benign client-
  // disconnect/outbound blips — which would otherwise silently swallow
  // a failure that actually broke a user-facing render. The original
  // is preserved in the Vercel log line below and via
  // includeLocalVariables on the captured frame.
  let tiles: LibraryTile[] = [];
  if (userId) {
    try {
      tiles = await loadLibraryTiles(userId);
    } catch (err) {
      console.error("[print-page] loadLibraryTiles failed:", err);
      logError(
        "print-page.loadLibraryTiles",
        new Error("Print library failed to load; rendered empty grid")
      );
    }
  }

  const linkSuffix = material ? `?material=${material.id}` : "";

  return (
    <PrintPageContent
      headline={material ? `Print with ${material.name}` : "Print a File"}
      subheadline={
        material
          ? "Pick one of your files or upload a new one — we'll quote it in this material."
          : "Get instant quotes from professional manufacturers worldwide."
      }
      tiles={tiles}
      linkSuffix={linkSuffix}
      preselectMaterialId={material?.id}
      initialExpandVendorId={initialExpandVendorId}
      checkoutModel={getCheckoutModel()}
    />
  );
}
