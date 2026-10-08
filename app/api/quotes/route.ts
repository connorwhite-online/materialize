import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getQuoteProvider,
  QuoteModelNotReadyError,
  type QuoteModelSource,
} from "@/lib/quotes";
import { quotesRequestSchema } from "@/lib/validations/print";
import { logError } from "@/lib/logger";

/**
 * Start a quote request and return its id immediately.
 * The client then polls GET /api/quotes/poll?priceId=...
 * to stream quotes in as vendors respond. This is intentionally
 * split from the snapshot endpoint so a slow vendor can't block the
 * user from seeing the fast ones — they arrive progressively.
 *
 * Provider-neutral: this route owns validation and access control;
 * which service prices the model is `getQuoteProvider()`'s business.
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

    const { currency, countryCode, quantity, materialId } = parsed.data;

    // Either an owned/published file asset (authed library path) or a
    // model the client already registered with the provider (anon draft
    // path — no DB row exists).
    let model: QuoteModelSource;
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

      model = { kind: "asset", asset: assetRow.asset };
    } else {
      model = { kind: "providerModel", modelId: parsed.data.modelId };
    }

    const { priceId } = await getQuoteProvider().startQuote({
      model,
      currency,
      countryCode,
      quantity,
      materialId,
    });

    console.log("[quotes] start", {
      priceId,
      model: model.kind === "asset" ? { fileAssetId: model.asset.id } : model,
      currency,
      countryCode,
      quantity,
      scopeMaterialId: materialId ?? null,
    });

    return Response.json({ priceId });
  } catch (error) {
    if (error instanceof QuoteModelNotReadyError) {
      return Response.json(
        {
          error:
            "File not yet uploaded for printing. Please wait a moment and try again.",
        },
        { status: 409 }
      );
    }
    logError("api/quotes", error);
    return Response.json(
      { error: "Failed to start quote request. Please try again." },
      { status: 500 }
    );
  }
}
