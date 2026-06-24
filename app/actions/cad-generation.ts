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
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations, fileAssets, files } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { runHarness } from "@/lib/cad/harness";
import {
  persistGenerationFailure,
  persistGenerationSuccess,
} from "@/lib/cad/persist";
import {
  isCadFeedbackTag,
  isCadRating,
  type CadRating,
} from "@/lib/cad/feedback";

export type GenerateCadResult =
  | { error: string; generationId?: string }
  | {
      generationId: string;
      fileAssetId: string;
      fileSlug: string;
      renderUrl: string | null;
      sourceCode: string;
      title: string | null;
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

  try {
    const result = await runHarness({ prompt, priorSourceCode });

    if (!result.ok || !result.run) {
      return persistGenerationFailure(
        generationId,
        result.error ?? "Could not produce a valid model.",
        result.sourceCode,
        result.attempts
      );
    }

    const persisted = await persistGenerationSuccess({
      userId,
      generationId,
      prompt,
      isRoot: !input.parentGenerationId,
      result,
    });

    revalidatePath("/text-to-cad");
    return persisted;
  } catch (error) {
    logError("generateCadModel", error);
    return persistGenerationFailure(
      generationId,
      "Generation failed. Please try again."
    );
  }
}

const MAX_NAME_LEN = 60;

export type SaveCadResult = { ok: true } | { error: string };

/**
 * "Save to profile" for a generated model: finalize the file the asset belongs
 * to (status published) so it leaves the studio's draft/editing space and
 * becomes a kept item in the owner's library — but keep it PRIVATE so it stays
 * off the public profile and the marketplace. Owner-only, idempotent. The user
 * can make it public / adjust pricing later from normal file management.
 */
export async function saveCadFileToProfile(input: {
  fileAssetId: string;
}): Promise<SaveCadResult> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  try {
    const [asset] = await db
      .select({ fileId: fileAssets.fileId, ownerId: files.userId })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, input.fileAssetId))
      .limit(1);
    if (!asset?.fileId || asset.ownerId !== userId) {
      return { error: "Model not found." };
    }

    await db
      .update(files)
      .set({ visibility: "private", status: "published", updatedAt: new Date() })
      .where(and(eq(files.id, asset.fileId), eq(files.userId, userId)));

    revalidatePath("/text-to-cad");
    return { ok: true };
  } catch (error) {
    logError("saveCadFileToProfile", error);
    return { error: "Save failed. Please try again." };
  }
}

export type RenameCadResult = { name: string } | { error: string };

/**
 * Rename a text-to-CAD build. Updates the file the given asset belongs to (so
 * the profile/library shows the new name) AND the thread's root title (so the
 * studio sidebar matches) — to the user these are one thing: the build's name.
 * Owner-only; the slug is intentionally left stable so existing links survive.
 */
export async function renameCadGeneration(input: {
  fileAssetId: string;
  name: string;
}): Promise<RenameCadResult> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    return { error: "Not found" };
  }

  const name = input.name?.trim() ?? "";
  if (name.length < 1) return { error: "Name can't be empty." };
  if (name.length > MAX_NAME_LEN) return { error: "Name is too long." };

  try {
    // Resolve the file behind the asset and confirm ownership.
    const [asset] = await db
      .select({ fileId: fileAssets.fileId, ownerId: files.userId })
      .from(fileAssets)
      .leftJoin(files, eq(fileAssets.fileId, files.id))
      .where(eq(fileAssets.id, input.fileAssetId))
      .limit(1);
    if (!asset?.fileId || asset.ownerId !== userId) {
      return { error: "Model not found." };
    }

    await db
      .update(files)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(files.id, asset.fileId), eq(files.userId, userId)));

    // Walk the generation that produced this asset up to its thread root and
    // retitle it, so the sidebar label tracks the rename.
    const [gen] = await db
      .select({
        id: cadGenerations.id,
        parentGenerationId: cadGenerations.parentGenerationId,
      })
      .from(cadGenerations)
      .where(
        and(
          eq(cadGenerations.fileAssetId, input.fileAssetId),
          eq(cadGenerations.userId, userId)
        )
      )
      .limit(1);

    if (gen) {
      let rootId = gen.id;
      let parentId = gen.parentGenerationId;
      const seen = new Set<string>([rootId]);
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const [parent] = await db
          .select({
            id: cadGenerations.id,
            parentGenerationId: cadGenerations.parentGenerationId,
          })
          .from(cadGenerations)
          .where(
            and(
              eq(cadGenerations.id, parentId),
              eq(cadGenerations.userId, userId)
            )
          )
          .limit(1);
        if (!parent) break;
        rootId = parent.id;
        parentId = parent.parentGenerationId;
      }
      await db
        .update(cadGenerations)
        .set({ title: name, updatedAt: new Date() })
        .where(eq(cadGenerations.id, rootId));
    }

    revalidatePath("/text-to-cad");
    return { name };
  } catch (error) {
    logError("renameCadGeneration", error);
    return { error: "Rename failed. Please try again." };
  }
}

export interface CadFeedbackInput {
  generationId: string;
  /** "good" | "bad" | null to clear. */
  rating: CadRating | null;
  /** Structured failure-mode tags; unknown tags are dropped. */
  tags: string[];
  note?: string | null;
}

/**
 * Record (or update) the owner's feedback on a generation — the in-the-
 * moment human eval signal surfaced on the scorecard at /text-to-cad/eval.
 * Gated like every other text-to-CAD surface, and the WHERE clause pins
 * userId so a caller can only rate their own rows. Idempotent.
 */
export async function recordCadFeedback(
  input: CadFeedbackInput
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  const rating = isCadRating(input.rating) ? input.rating : null;
  const tags = Array.from(
    new Set((input.tags ?? []).filter(isCadFeedbackTag))
  ).slice(0, 12);
  const note = (input.note ?? "").trim().slice(0, 1000) || null;

  try {
    const updated = await db
      .update(cadGenerations)
      .set({
        rating,
        feedbackTags: tags,
        feedbackNote: note,
        feedbackAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(cadGenerations.id, input.generationId),
          eq(cadGenerations.userId, userId)
        )
      )
      .returning({ id: cadGenerations.id });

    if (updated.length === 0) return { error: "Not found" };

    revalidatePath("/text-to-cad");
    revalidatePath("/text-to-cad/eval");
    return { ok: true };
  } catch (error) {
    logError("recordCadFeedback", error);
    return { error: "Could not save feedback." };
  }
}

/**
 * Delete a build from the studio history — removes the generation rows for the
 * thread (root + revisions). The underlying library files/assets are left
 * intact (they may be saved/printed); this only clears the build from history.
 */
export async function deleteCadBuild(input: {
  generationIds: string[];
}): Promise<{ ok: true } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  const ids = Array.from(new Set(input.generationIds)).filter(Boolean);
  if (ids.length === 0) return { error: "Nothing to delete" };

  try {
    await db
      .delete(cadGenerations)
      .where(
        and(
          inArray(cadGenerations.id, ids),
          eq(cadGenerations.userId, userId)
        )
      );
    revalidatePath("/text-to-cad");
    return { ok: true };
  } catch (error) {
    logError("deleteCadBuild", error);
    return { error: "Could not delete build." };
  }
}
