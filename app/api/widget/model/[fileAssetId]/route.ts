import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets } from "@/lib/db/schema";
import { getObjectBytes } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { verifyWidgetModelToken } from "@/lib/mcp/widgets/model-token";

/**
 * Model bytes for the ChatGPT / Claude widgets' 3D preview.
 *
 * The widget's iframe lives on the host's sandbox origin with no session,
 * so access is a signed token minted by the MCP tool that already checked
 * ownership (lib/mcp/widgets/model-token.ts), and CORS is open: the token
 * is the gate, not the origin. Public at the proxy layer
 * (lib/auth/public-routes.ts) for the same reason.
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
  if (!verifyWidgetModelToken(fileAssetId, token)) {
    return new Response("Forbidden", { status: 403, headers: CORS });
  }

  try {
    const [asset] = await db
      .select({ storageKey: fileAssets.storageKey, format: fileAssets.format })
      .from(fileAssets)
      .where(eq(fileAssets.id, fileAssetId))
      .limit(1);
    if (!asset) return new Response("Not found", { status: 404, headers: CORS });

    const mime = FORMAT_MIME[asset.format];
    // STEP/AMF have no browser loader; the widget shows its fallback.
    if (!mime) {
      return new Response("Unsupported format", { status: 415, headers: CORS });
    }

    const bytes = await getObjectBytes(asset.storageKey);
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
