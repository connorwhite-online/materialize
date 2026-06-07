import { auth } from "@clerk/nextjs/server";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { PrintPageContent } from "@/components/print/print-page-content";
import { loadLibraryTiles, type LibraryTile } from "@/lib/print/library-tiles";
import { loadProjectPrintTiles } from "@/lib/print/project-tiles";
import { logError } from "@/lib/logger";

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
  // the material-step auto-skip.
  const material = materialId
    ? (await getCraftCloudCatalog()).materialById.get(materialId) ?? null
    : null;

  const { userId } = await auth();

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
          headline={`Print ${projectCtx.projectName}`}
          subheadline={
            projectCtx.tiles.length > 0
              ? "Configure each file, add it to your cart, then check out together."
              : "This project doesn't have any printable files yet."
          }
          tiles={projectCtx.tiles}
          linkSuffix={`?project=${encodeURIComponent(projectCtx.projectSlug)}`}
          tilesLabel="Files in this project"
          tilesDefaultExpanded
          initialExpandVendorId={initialExpandVendorId}
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
    />
  );
}
