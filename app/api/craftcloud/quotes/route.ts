import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createPriceRequest, getPrice } from "@/lib/craftcloud/client";
import { quotesRequestSchema } from "@/lib/validations/print";
import { logError } from "@/lib/logger";

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

    const { fileAssetId, currency, countryCode, quantity } = parsed.data;

    // Get the file asset with access check
    const [assetRow] = await db
      .select({
        asset: fileAssets,
        fileUserId: files.userId,
        fileStatus: files.status,
      })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, fileAssetId));

    if (!assetRow) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    const isOwner = userId && assetRow.fileUserId === userId;
    const isPublished = assetRow.fileStatus === "published";
    if (!isOwner && !isPublished) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    const modelId = assetRow.asset.craftCloudModelId;
    if (!modelId) {
      return Response.json(
        { error: "File not yet uploaded for printing. Please wait a moment and try again." },
        { status: 409 }
      );
    }

    // Create price request
    const { priceId } = await createPriceRequest({
      currency,
      countryCode,
      models: [{ modelId, quantity }],
    });

    // Poll for prices with progressive results
    let priceResponse = await getPrice(priceId);
    let attempts = 0;
    while (priceResponse.status === "pending" && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      priceResponse = await getPrice(priceId);
      attempts++;
    }

    if (!priceResponse.quotes?.length) {
      return Response.json(
        { error: "No quotes available for this file. The model may be too large or complex for available materials." },
        { status: 404 }
      );
    }

    return Response.json({
      quotes: priceResponse.quotes,
      shipping: priceResponse.shipping || [],
      priceId,
    });
  } catch (error) {
    logError("api/craftcloud/quotes", error);
    return Response.json(
      { error: "Failed to fetch quotes. Please try again." },
      { status: 500 }
    );
  }
}
