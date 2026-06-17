"use server";

/**
 * Server action for the experimental, owner-only text-to-CAD studio.
 *
 * Flow (see lib/cad/harness.ts for the generate->execute->validate->repair
 * loop): gate on canUseTextToCad -> insert a `pending` cad_generations row
 * -> run the harness -> on success, write the STL to R2 under the caller's
 * prefix and reuse createDraftFileForPrint to mint a printable library
 * asset -> mark the row `succeeded` with the asset id. The returned
 * fileAssetId routes the user straight into the existing quote configurator
 * at /print/[fileAssetId].
 *
 * Gating is re-checked here (not just on the page) so the mutation surface
 * is closed even if the page guard is ever bypassed.
 */

import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { runHarness } from "@/lib/cad/harness";
import { putObject, generateDownloadUrl } from "@/lib/storage";
import { createDraftFileForPrint } from "@/app/actions/files";

export type GenerateCadResult =
  | { error: string; generationId?: string }
  | {
      generationId: string;
      fileAssetId: string;
      fileSlug: string;
      renderUrl: string | null;
      sourceCode: string;
    };

export async function generateCadModel(input: {
  prompt: string;
  /** Set when revising an existing generation ("edit existing"). */
  parentGenerationId?: string;
}): Promise<GenerateCadResult> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    // Mirror the page's notFound() — don't reveal the feature exists.
    return { error: "Not found" };
  }

  const prompt = input.prompt?.trim() ?? "";
  if (prompt.length < 3) return { error: "Describe what you want to make." };
  if (prompt.length > 2000) return { error: "Prompt is too long." };

  // When editing, load the parent's source to seed the harness — and
  // verify it belongs to the caller.
  let priorSourceCode: string | null = null;
  if (input.parentGenerationId) {
    const [parent] = await db
      .select({
        sourceCode: cadGenerations.sourceCode,
        userId: cadGenerations.userId,
      })
      .from(cadGenerations)
      .where(eq(cadGenerations.id, input.parentGenerationId))
      .limit(1);
    if (!parent || parent.userId !== userId) {
      return { error: "Original model not found." };
    }
    priorSourceCode = parent.sourceCode;
  }

  const [row] = await db
    .insert(cadGenerations)
    .values({
      userId,
      prompt,
      engine: "build123d",
      parentGenerationId: input.parentGenerationId ?? null,
      status: "pending",
    })
    .returning({ id: cadGenerations.id });
  const generationId = row.id;

  const fail = async (message: string, sourceCode = "", attempts = 0) => {
    await db
      .update(cadGenerations)
      .set({
        status: "failed",
        sourceCode: sourceCode || null,
        attempts,
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(cadGenerations.id, generationId));
    return { error: message, generationId };
  };

  try {
    const result = await runHarness({ prompt, priorSourceCode });

    if (!result.ok || !result.run) {
      return fail(
        result.error ?? "Could not produce a valid model.",
        result.sourceCode,
        result.attempts
      );
    }

    const stlB64 = result.run.files.stl;
    if (!stlB64) {
      return fail("Model produced no printable output.", result.sourceCode, result.attempts);
    }

    const bytes = new Uint8Array(Buffer.from(stlB64, "base64"));
    const storageKey = `uploads/${userId}/${nanoid()}/model.stl`;
    await putObject(storageKey, bytes, "model/stl");

    const draft = await createDraftFileForPrint({
      storageKey,
      originalFilename: "model.stl",
      format: "stl",
      fileSize: bytes.byteLength,
    });
    if ("error" in draft) {
      return fail(draft.error, result.sourceCode, result.attempts);
    }

    // Store the preview render in R2 (not inline in the DB) and mint a
    // short-lived URL for immediate display. Best-effort: a render failure
    // must not fail an otherwise-good generation.
    let renderStorageKey: string | null = null;
    let renderUrl: string | null = null;
    if (result.run.renderPng) {
      try {
        renderStorageKey = `cad-renders/${userId}/${nanoid()}.png`;
        await putObject(
          renderStorageKey,
          new Uint8Array(Buffer.from(result.run.renderPng, "base64")),
          "image/png"
        );
        renderUrl = await generateDownloadUrl(renderStorageKey);
      } catch (err) {
        logError("generateCadModel.render", err);
        renderStorageKey = null;
        renderUrl = null;
      }
    }

    await db
      .update(cadGenerations)
      .set({
        status: "succeeded",
        sourceCode: result.sourceCode,
        attempts: result.attempts,
        fileAssetId: draft.fileAssetId,
        renderStorageKey,
        updatedAt: new Date(),
      })
      .where(eq(cadGenerations.id, generationId));

    revalidatePath("/text-to-cad");

    return {
      generationId,
      fileAssetId: draft.fileAssetId,
      fileSlug: draft.fileSlug,
      renderUrl,
      sourceCode: result.sourceCode,
    };
  } catch (error) {
    logError("generateCadModel", error);
    return fail("Generation failed. Please try again.");
  }
}
