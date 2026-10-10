import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { getObjectBytes } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { readWidgetModelToken } from "@/lib/mcp/widgets/model-token";
import { getPreviewBytes } from "@/lib/files/model-preview";

/**
 * Model bytes for the ChatGPT / Claude widgets' 3D preview.
 *
 * The widget's iframe lives on the host's sandbox origin with no session,
 * so access is a signed token minted by the MCP tool that already checked
 * access (lib/mcp/widgets/model-token.ts), and CORS is open: the token
 * is the gate, not the origin. Public at the proxy layer
 * (lib/auth/public-routes.ts) for the same reason.
 *
 * Paid listings: the token's variant decides. Only a `full` token — minted
 * for a caller entitled to the file — gets the original; a `preview` token
 * gets the low-detail copy (lib/files/model-preview.ts), same format.
 * The two variants are different token strings, so they are different
 * URLs and the cache below can't hand one to the other.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const FORMAT_MIME: Record<string, string> = {
  stl: "model/stl",
  obj: "text/plain",
  "3mf": "model/3mf",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(
  request: Request,
  props: { params: Promise<{ fileAssetId: string }> }
) {
  const { fileAssetId } = await props.params;
  const token = new URL(request.url).searchParams.get("t");
  const variant = readWidgetModelToken(fileAssetId, token);
  if (!variant) {
    return new Response("Forbidden", { status: 403, headers: CORS });
  }

  try {
    const [asset] = await db
      .select({
        storageKey: fileAssets.storageKey,
        format: fileAssets.format,
        filePrice: files.price,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId))
      .limit(1);
    if (!asset) return new Response("Not found", { status: 404, headers: CORS });

    const mime = FORMAT_MIME[asset.format];
    // STEP/AMF have no browser loader; the widget shows its fallback.
    if (!mime) {
      return new Response("Unsupported format", { status: 415, headers: CORS });
    }

    const lowDetail = (asset.filePrice ?? 0) > 0 && variant !== "full";
    const bytes = lowDetail
      ? await getPreviewBytes({
          id: fileAssetId,
          storageKey: asset.storageKey,
          format: asset.format,
        })
      : await getObjectBytes(asset.storageKey);
    if (!bytes) {
      // Unparseable paid file: no low-detail copy, and never the original.
      return new Response("Unsupported format", { status: 415, headers: CORS });
    }
    return new Response(Buffer.from(bytes), {
      headers: {
        ...CORS,
        "Content-Type": mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    logError("widget.model", err);
    return new Response("Error", { status: 500, headers: CORS });
  }
}
