import { auth } from "@clerk/nextjs/server";
import { generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";

/**
 * Owner-only sibling of `/api/files/preview/[fileAssetId]` for the
 * pre-listing flow, where the upload preview only knows the storage
 * key (the file row hasn't been created yet).
 *
 * Access is gated by the `uploads/{userId}/` prefix the upload URL
 * generator stamps onto every key — same check the JSON metadata
 * endpoint uses. There's no published / non-owner path here on
 * purpose: keys outside the user's prefix aren't theirs to preview,
 * and we don't want a generic "stream any R2 key" hole.
 */
export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response("Missing key", { status: 400 });
    }
    if (!key.startsWith(`uploads/${userId}/`)) {
      return new Response("Forbidden", { status: 403 });
    }

    const downloadUrl = await generateDownloadUrl(key, 300);
    const upstream = await fetch(downloadUrl, { signal: request.signal });
    if (!upstream.ok || !upstream.body) {
      return new Response("Upstream fetch failed", { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, max-age=86400, immutable",
    });
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength) headers.set("Content-Length", upstreamLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    logError("api/files/preview/by-key", error);
    return new Response("Preview failed", { status: 500 });
  }
}
