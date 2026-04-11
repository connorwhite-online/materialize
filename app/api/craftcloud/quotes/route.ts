import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  uploadModel,
  getModel,
  createPriceRequest,
  getPrice,
} from "@/lib/craftcloud/client";
import { generateDownloadUrl } from "@/lib/storage";
import type { Currency } from "@/lib/craftcloud/types";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { fileAssetId, currency = "USD", countryCode = "US", quantity = 1 } = body as {
    fileAssetId: string;
    currency?: Currency;
    countryCode?: string;
    quantity?: number;
  };

  // Get the file asset
  const [asset] = await db
    .select()
    .from(fileAssets)
    .where(eq(fileAssets.id, fileAssetId));

  if (!asset) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }

  let modelId = asset.craftCloudModelId;

  // Upload to Craft Cloud if not already uploaded
  if (!modelId) {
    // Get the file from R2
    const downloadUrl = await generateDownloadUrl(asset.storageKey, 300);
    const fileRes = await fetch(downloadUrl);
    const fileBuffer = new Uint8Array(await fileRes.arrayBuffer());

    const model = await uploadModel(
      fileBuffer,
      asset.originalFilename,
      "mm"
    );
    modelId = model.id;

    // Cache the model ID
    await db
      .update(fileAssets)
      .set({
        craftCloudModelId: modelId,
        geometryData: model.geometry
          ? {
              dimensions: model.geometry.dimensions,
              volume: model.geometry.volume,
              triangleCount: model.geometry.triangleCount,
            }
          : undefined,
      })
      .where(eq(fileAssets.id, fileAssetId));
  }

  // Request prices
  const { priceId } = await createPriceRequest({
    currency,
    countryCode,
    models: [{ modelId, quantity }],
  });

  // Poll for prices (in production, use WebSocket)
  let priceResponse = await getPrice(priceId);
  let attempts = 0;
  while (priceResponse.status === "pending" && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    priceResponse = await getPrice(priceId);
    attempts++;
  }

  return Response.json({
    quotes: priceResponse.quotes,
    shipping: priceResponse.shipping,
    priceId,
  });
}
