import { after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { isPublicListing } from "@/lib/files/public-listing";
import { eq } from "drizzle-orm";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { isOrgMember } from "@/lib/authorization";
import { promoteStudioDraftsForAssets } from "@/lib/studio-drafts";
import { ownsLoadedFile } from "@/lib/entitlement";
import {
  getPreviewBytes,
  needsLowDetailPreview,
  PREVIEW_KEY_VERSION,
} from "@/lib/files/model-preview";

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
 * Access policy: published, public files are previewable by anyone
 * (mirrors the detail page); drafts and private files are owner/org-only.
 * Anything that pulls model bytes back into the browser flows through
 * here, so this is the one place to enforce that policy.
 *
 * Paid listings (files.price > 0): a viewer who isn't entitled to the
 * file (lib/entitlement.ts — creator, org member, collaborator, buyer of
 * the file or of a project bundling it) gets the low-detail copy from
 * lib/files/model-preview.ts, in the same format, never the original.
 * STEP/AMF have no low-detail copy, so they get a 403 and the viewer
 * shows its placeholder.
 *
 * Caching: both variants share this URL, so a paid listing's response
 * must never be reused across an entitlement change (buy it, and the
 * next view must be full detail). Paid responses are therefore
 * `private, no-cache` with a variant-specific ETag: the browser keeps
 * the bytes but asks every time, and a matching If-None-Match gets a 304
 * after the access + entitlement check — no R2 read. After a purchase
 * the ETag no longer matches and the full mesh comes back. `Vary: Cookie`
 * was the alternative and is worse: Clerk rotates the __session cookie
 * every minute, so it would be a cache miss on almost every view anyway.
 * Free listings keep the long immutable cache — nothing about them
 * depends on who is asking beyond the access gate.
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
        fileId: files.id,
        filePrice: files.price,
        fileUserId: files.userId,
        fileOrganizationId: files.organizationId,
        fileStatus: files.status,
        fileVisibility: files.visibility,
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
    const isPublished = isPublicListing(assetRow);
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

    // Entitlement only matters for a paid listing; free files and the
    // owner/org path (canView) skip the extra queries entirely.
    const isPaid = (assetRow.filePrice ?? 0) > 0;
    const entitled =
      !isPaid ||
      canView ||
      (!!assetRow.fileId &&
        !!assetRow.fileUserId &&
        (await ownsLoadedFile(userId ?? null, {
          id: assetRow.fileId,
          price: assetRow.filePrice ?? 0,
          userId: assetRow.fileUserId,
          organizationId: assetRow.fileOrganizationId,
        })));
    const lowDetail = needsLowDetailPreview({
      price: assetRow.filePrice,
      entitled,
    });
    const contentType =
      FORMAT_MIME[assetRow.format] ?? "application/octet-stream";

    if (isPaid) {
      const etag = lowDetail
        ? `"${fileAssetId}.preview.v${PREVIEW_KEY_VERSION}"`
        : `"${fileAssetId}.full"`;
      const paidHeaders = {
        "Cache-Control": "private, no-cache",
        ETag: etag,
      };
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: paidHeaders });
      }
      if (lowDetail) {
        const bytes = await getPreviewBytes({
          id: fileAssetId,
          storageKey: assetRow.storageKey,
          format: assetRow.format,
        });
        if (!bytes) {
          return new Response("Purchase required for this format", {
            status: 403,
          });
        }
        return new Response(Buffer.from(bytes), {
          status: 200,
          headers: {
            ...paidHeaders,
            "Content-Type": contentType,
            "Content-Length": String(bytes.byteLength),
          },
        });
      }
    }

    const downloadUrl = await generateDownloadUrl(assetRow.storageKey, 300);
    // Forward the client's AbortSignal so a navigation away during
    // load doesn't keep the upstream R2 connection open.
    const upstream = await fetch(downloadUrl, { signal: request.signal });
    if (!upstream.ok || !upstream.body) {
      return new Response("Upstream fetch failed", { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": contentType,
      // Storage keys are immutable per asset (uploads are content-
      // addressed at create time), so a free file's bytes are safe to
      // cache for the full life of the URL. Private because the proxy
      // itself is auth-gated. Paid files revalidate (see header comment).
      "Cache-Control": isPaid
        ? "private, no-cache"
        : "private, max-age=86400, immutable",
    });
    if (isPaid) headers.set("ETag", `"${fileAssetId}.full"`);
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
