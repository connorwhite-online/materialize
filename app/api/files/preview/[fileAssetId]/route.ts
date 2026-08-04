import { after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { isOrgMember } from "@/lib/authorization";
import { promoteStudioDraftsForAssets } from "@/lib/studio-drafts";

/**
 * Same-origin streaming proxy for the asset's bytes.
 *
 * Browser-side three.js loaders (`STLLoader`, `OBJLoader`, `ThreeMFLoader`)
 * and the CraftCloud-upload helper both `fetch()` the model from this
 * URL. Talking directly to R2 from the browser would need a CORS
 * preflight allowing every origin we ship from (production, preview
 * deploys, dev), and the bucket only has CORS configured for the upload
 * PUT — every GET browser-side trips "Failed to fetch". Keeping the R2
 * read on the server kills the dependency on bucket-side CORS for
 * downloads entirely.
 *
 * Access policy: published files are previewable by anyone (mirrors the
 * detail page); draft files are owner-only. Anything that pulls model
 * bytes back into the browser flows through here, so this is the one
 * place to enforce that policy.
 */

const FORMAT_MIME: Record<string, string> = {
  stl: "model/stl",
  obj: "text/plain",
  "3mf": "model/3mf",
  step: "application/step",
  amf: "application/x-amf",
};

export async function GET(
  request: Request,
  props: { params: Promise<{ fileAssetId: string }> }
) {
  const { fileAssetId } = await props.params;

  try {
    const { userId } = await auth();

    const [assetRow] = await db
      .select({
        storageKey: fileAssets.storageKey,
        format: fileAssets.format,
        fileUserId: files.userId,
        fileOrganizationId: files.organizationId,
        fileStatus: files.status,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId));

    if (!assetRow) {
      return new Response("Not found", { status: 404 });
    }

    const canView =
      !!userId &&
      (assetRow.fileUserId === userId ||
        (assetRow.fileOrganizationId !== null &&
          (await isOrgMember(userId, assetRow.fileOrganizationId)).member));
    const isPublished = assetRow.fileStatus === "published";
    if (!canView && !isPublished) {
      return new Response("Forbidden", { status: 403 });
    }

    // `?download=1` marks a deliberate file download (the studio's Download
    // button / assembly zip), as opposed to a viewer/loader fetch of the same
    // URL. A download means the artifact left the studio — for the OWNER's
    // own unsaved studio draft that is a promotion event, same as a print
    // order ("a download is a save", docs/text-to-cad/10). Best-effort and
    // after the response starts; a promotion hiccup must never break the
    // download itself. No-op for anything that isn't an unsaved studio draft.
    const isDownload =
      new URL(request.url).searchParams.get("download") === "1";
    if (isDownload && userId && assetRow.fileUserId === userId) {
      after(() =>
        promoteStudioDraftsForAssets({
          userId,
          fileAssetIds: [fileAssetId],
        })
      );
    }

    const downloadUrl = await generateDownloadUrl(assetRow.storageKey, 300);
    // Forward the client's AbortSignal so a navigation away during
    // load doesn't keep the upstream R2 connection open.
    const upstream = await fetch(downloadUrl, { signal: request.signal });
    if (!upstream.ok || !upstream.body) {
      return new Response("Upstream fetch failed", { status: 502 });
    }

    const headers = new Headers({
      "Content-Type":
        FORMAT_MIME[assetRow.format] ?? "application/octet-stream",
      // Storage keys are immutable per asset (uploads are content-
      // addressed at create time), so the bytes are safe to cache for
      // the full life of the URL. Private because the proxy itself is
      // auth-gated.
      "Cache-Control": "private, max-age=86400, immutable",
    });
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength) headers.set("Content-Length", upstreamLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    // AbortError just means the client navigated away — not a real
    // failure, don't pollute logs.
    if ((error as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    logError("api/files/preview", error);
    return new Response("Preview failed", { status: 500 });
  }
}
