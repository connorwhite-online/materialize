import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createPriceRequest } from "@/lib/craftcloud/client";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { quotesRequestSchema } from "@/lib/validations/print";
import { logError } from "@/lib/logger";

/**
 * Start a CraftCloud price request and return its id immediately.
 * The client then polls GET /api/craftcloud/quotes/poll?priceId=...
 * to stream quotes in as vendors respond. This is intentionally
 * split from the snapshot endpoint so a slow vendor can't block the
 * user from seeing the fast ones — they arrive progressively.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    const body = await request.json();
    const parsed = quotesRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { currency, countryCode, quantity, materialId: scopeMaterialId } =
      parsed.data;

    // Resolve a CraftCloud modelId from either an owned file asset
    // (authed library path) or a direct modelId (anon draft path —
    // the client uploaded straight to CraftCloud, no DB row exists).
    let modelId: string;
    if ("fileAssetId" in parsed.data) {
      const [assetRow] = await db
        .select({
          asset: fileAssets,
          fileUserId: files.userId,
          fileStatus: files.status,
        })
        .from(fileAssets)
        .leftJoin(files, eq(fileAssets.fileId, files.id))
        .where(eq(fileAssets.id, parsed.data.fileAssetId));

      if (!assetRow) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      const isOwner = userId && assetRow.fileUserId === userId;
      const isPublished = assetRow.fileStatus === "published";
      if (!isOwner && !isPublished) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }

      const resolved = assetRow.asset.craftCloudModelId;
      if (!resolved) {
        return Response.json(
          {
            error:
              "File not yet uploaded for printing. Please wait a moment and try again.",
          },
          { status: 409 }
        );
      }
      modelId = resolved;
    } else {
      modelId = parsed.data.modelId;
    }

    // If the client passed a material-scope hint, expand it to the
    // full set of materialConfigIds for that material and forward
    // them to CraftCloud. This narrows the vendor poll so we only
    // hear from vendors that actually offer configs of this
    // material — much faster first paint when coming from a
    // /materials/[slug] "Print with X" entry.
    let materialConfigIds: string[] | undefined;
    if (scopeMaterialId) {
      const catalog = await getCraftCloudCatalog();
      const material = catalog.materialById.get(scopeMaterialId);
      if (material) {
        const ids: string[] = [];
        for (const finishGroup of material.finishGroups ?? []) {
          for (const config of finishGroup.materialConfigs ?? []) {
            ids.push(config.id);
          }
        }
        materialConfigIds = ids.length > 0 ? ids : undefined;
      }
    }

    const { priceId } = await createPriceRequest({
      currency,
      countryCode,
      models: [{ modelId, quantity }],
      materialConfigIds,
    });

    console.log("[quotes] start", {
      priceId,
      modelId,
      currency,
      countryCode,
      quantity,
      scopeMaterialId: scopeMaterialId ?? null,
      scopedConfigCount: materialConfigIds?.length ?? null,
    });

    return Response.json({ priceId });
  } catch (error) {
    logError("api/craftcloud/quotes", error);
    return Response.json(
      { error: "Failed to start quote request. Please try again." },
      { status: 500 }
    );
  }
}
