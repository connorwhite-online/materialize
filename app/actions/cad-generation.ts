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
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  cadGenerations,
  cadThreads,
  cartItems,
  fileAssets,
  files,
  printOrderItems,
  printOrders,
  projectFiles,
} from "@/lib/db/schema";
import { deleteObject, generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { canUseTextToCad } from "@/lib/features";
import { userOwnsFile } from "@/lib/entitlement";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import {
  isCadFeedbackTag,
  isCadRating,
  type CadRating,
} from "@/lib/cad/feedback";

// Generation itself lives in the jobs path (app/api/cad/generate ->
// lib/cad/jobs.ts -> lib/cad/orchestrate.ts). The old inline generateCadModel
// action was deleted (MTR-167): it had zero production callers and silently
// diverged from the real path (no routing, no brief, no job row, no
// cancellation) — a trap for the next caller.

const MAX_NAME_LEN = 60;

export type SaveCadResult = { ok: true } | { error: string };

/**
 * True when any of the given assets is referenced by a print order, an
 * order item, or a cart item. Assets with order/cart references must
 * NEVER be re-pointed or mutated — printOrders.fileAssetId has to keep
 * meaning "the geometry that was ordered" (docs/text-to-cad/05 §C).
 */
async function anyAssetOrderReferenced(assetIds: string[]): Promise<boolean> {
  if (assetIds.length === 0) return false;
  const [order] = await db
    .select({ id: printOrders.id })
    .from(printOrders)
    .where(inArray(printOrders.fileAssetId, assetIds))
    .limit(1);
  if (order) return true;
  const [item] = await db
    .select({ id: printOrderItems.id })
    .from(printOrderItems)
    .where(inArray(printOrderItems.fileAssetId, assetIds))
    .limit(1);
  if (item) return true;
  const [cartItem] = await db
    .select({ id: cartItems.id })
    .from(cartItems)
    .where(inArray(cartItems.fileAssetId, assetIds))
    .limit(1);
  return !!cartItem;
}

/** True when any of the given files is bundled into a Project. */
async function anyFileInProject(fileIds: string[]): Promise<boolean> {
  if (fileIds.length === 0) return false;
  const [row] = await db
    .select({ fileId: projectFiles.fileId })
    .from(projectFiles)
    .where(inArray(projectFiles.fileId, fileIds))
    .limit(1);
  return !!row;
}

/**
 * "Save to profile" for a generated model.
 *
 * First save of a design: finalize the file the asset belongs to (status
 * published) so it leaves the studio's draft space and becomes a kept item in
 * the owner's library — but keep it PRIVATE so it stays off the public profile
 * and the marketplace. `source` stays 'studio' on purpose: source is
 * provenance (where the file came from), status is the visibility stage.
 * The design's thread records the file as its savedFileId.
 *
 * Re-save of an already-saved design (docs/text-to-cad/05 §C, one file per
 * design): instead of publishing a second library file, the SAVED file is
 * re-pointed at this generation's asset — the saved file's old asset rows move
 * onto this generation's (invisible) draft file and this generation's asset
 * moves under the saved file, so every reader that resolves "the file's asset"
 * (they all take the file's first/only asset row) sees the new geometry while
 * the saved file's id and slug stay stable. Assets referenced by print
 * orders/cart items are never moved; in that case (and for assemblies /
 * project-bundled files) we fall back to publishing this generation's file and
 * demoting the previously saved studio file back to draft, so the library
 * still shows exactly one entry per design.
 *
 * Owner-only, idempotent.
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

    // The generation that produced this asset → its thread. Latest row wins
    // when byte-hash dedup pointed several generations at one asset.
    const [gen] = await db
      .select({
        id: cadGenerations.id,
        threadId: cadGenerations.threadId,
        projectId: cadGenerations.projectId,
      })
      .from(cadGenerations)
      .where(
        and(
          eq(cadGenerations.fileAssetId, input.fileAssetId),
          eq(cadGenerations.userId, userId)
        )
      )
      .orderBy(desc(cadGenerations.createdAt))
      .limit(1);

    const [thread] = gen?.threadId
      ? await db
          .select({
            id: cadThreads.id,
            savedFileId: cadThreads.savedFileId,
          })
          .from(cadThreads)
          .where(
            and(eq(cadThreads.id, gen.threadId), eq(cadThreads.userId, userId))
          )
          .limit(1)
      : [];

    // The previously saved file for this design, when it's a DIFFERENT file
    // that still exists and is ours (FK is SET NULL on delete, but re-check).
    let priorSavedFileId: string | null = null;
    if (thread?.savedFileId && thread.savedFileId !== asset.fileId) {
      const [prior] = await db
        .select({ id: files.id, source: files.source })
        .from(files)
        .where(
          and(eq(files.id, thread.savedFileId), eq(files.userId, userId))
        )
        .limit(1);
      priorSavedFileId = prior?.id ?? null;
    }

    if (!priorSavedFileId) {
      // First save of this design (or re-save of the same file): publish in
      // place. `source` stays 'studio' — provenance, not stage.
      await db
        .update(files)
        .set({
          visibility: "private",
          status: "published",
          updatedAt: new Date(),
        })
        .where(and(eq(files.id, asset.fileId), eq(files.userId, userId)));

      if (thread && gen) {
        await db
          .update(cadThreads)
          .set({
            savedFileId: asset.fileId,
            activeGenerationId: gen.id,
            updatedAt: new Date(),
          })
          .where(eq(cadThreads.id, thread.id));
      }

      revalidatePath("/prometheus");
      return { ok: true };
    }

    // One file per design: re-point the saved file at this generation's
    // asset when it's safe (no order/cart references on either side, not an
    // assembly, neither file bundled into a project).
    const savedAssets = await db
      .select({ id: fileAssets.id })
      .from(fileAssets)
      .where(eq(fileAssets.fileId, priorSavedFileId));

    const canRepoint =
      gen != null &&
      thread != null &&
      gen.projectId === null &&
      !(await anyAssetOrderReferenced([
        input.fileAssetId,
        ...savedAssets.map((a) => a.id),
      ])) &&
      !(await anyFileInProject([asset.fileId, priorSavedFileId]));

    if (canRepoint) {
      // Swap so each file keeps exactly one asset (readers resolve "the
      // file's asset" as the first/only fileAssets row — see
      // lib/print/library-tiles.ts and files/[slug]/page.tsx): the saved
      // file's old assets park on this generation's invisible draft file
      // (preserving old geometry + its generation links), and this
      // generation's asset becomes the saved file's asset. Slug stable.
      // ORDER MATTERS (no transaction on neon-http): attach the new asset
      // FIRST — a crash between statements then leaves the saved file with
      // two assets (readers resolve the older one: stale but working, and a
      // re-save completes the swap) instead of zero (broken page + print).
      // The park step targets the captured old-asset ids, not fileId, so it
      // can't sweep up the freshly attached asset.
      await db
        .update(fileAssets)
        .set({ fileId: priorSavedFileId })
        .where(eq(fileAssets.id, input.fileAssetId));
      if (savedAssets.length > 0) {
        await db
          .update(fileAssets)
          .set({ fileId: asset.fileId })
          .where(
            inArray(
              fileAssets.id,
              savedAssets.map((a) => a.id)
            )
          );
      }
      await db
        .update(files)
        .set({ status: "published", updatedAt: new Date() })
        .where(and(eq(files.id, priorSavedFileId), eq(files.userId, userId)));
      await db
        .update(cadThreads)
        .set({ activeGenerationId: gen.id, updatedAt: new Date() })
        .where(eq(cadThreads.id, thread.id));
    } else {
      // Conservative fallback: publish this generation's file as THE file
      // for the design and demote the previously saved STUDIO file back to
      // draft (library-invisible), so the library still shows one entry per
      // design. The demoted file (and any ordered geometry) is untouched
      // otherwise — orders keep referencing their original assets. Only
      // studio-sourced files are ever demoted; a real upload never is.
      await db
        .update(files)
        .set({
          visibility: "private",
          status: "published",
          updatedAt: new Date(),
        })
        .where(and(eq(files.id, asset.fileId), eq(files.userId, userId)));
      await db
        .update(files)
        .set({ status: "draft", updatedAt: new Date() })
        .where(
          and(
            eq(files.id, priorSavedFileId),
            eq(files.userId, userId),
            eq(files.source, "studio")
          )
        );
      if (thread && gen) {
        await db
          .update(cadThreads)
          .set({
            savedFileId: asset.fileId,
            activeGenerationId: gen.id,
            updatedAt: new Date(),
          })
          .where(eq(cadThreads.id, thread.id));
      }
    }

    revalidatePath("/prometheus");
    return { ok: true };
  } catch (error) {
    logError("saveCadFileToProfile", error);
    return { error: "Save failed. Please try again." };
  }
}

/**
 * Pin a generation as its thread's active version (docs/text-to-cad/05 §D
 * item 2). `activeGenerationId` is what the thread currently "is" — it
 * defaults to the latest successful generation (persistGenerationSuccess
 * re-points it on every new success), and this lets the user pin an older
 * one instead. Owner-only, gated like every other text-to-CAD surface.
 * Legacy pre-thread generations (threadId NULL) can't be pinned.
 */
export async function setActiveCadVersion(input: {
  generationId: string;
}): Promise<{ ok: true } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  try {
    const [gen] = await db
      .select({
        id: cadGenerations.id,
        userId: cadGenerations.userId,
        threadId: cadGenerations.threadId,
        status: cadGenerations.status,
      })
      .from(cadGenerations)
      .where(eq(cadGenerations.id, input.generationId))
      .limit(1);
    if (!gen || gen.userId !== userId) return { error: "Version not found." };
    if (!gen.threadId) return { error: "This build doesn't support pinning." };
    if (gen.status !== "succeeded") {
      return { error: "Only a successful version can be pinned." };
    }

    const updated = await db
      .update(cadThreads)
      .set({ activeGenerationId: gen.id, updatedAt: new Date() })
      .where(
        and(eq(cadThreads.id, gen.threadId), eq(cadThreads.userId, userId))
      )
      .returning({ id: cadThreads.id });
    if (updated.length === 0) return { error: "Version not found." };

    revalidatePath("/prometheus");
    return { ok: true };
  } catch (error) {
    logError("setActiveCadVersion", error);
    return { error: "Could not pin this version." };
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

    // Retitle the thread so the sidebar label tracks the rename. Threaded
    // rows (docs/text-to-cad/05 §A) do it in one UPDATE on cadThreads;
    // legacy pre-migration rows keep the old root-walk fallback.
    const [gen] = await db
      .select({
        id: cadGenerations.id,
        parentGenerationId: cadGenerations.parentGenerationId,
        threadId: cadGenerations.threadId,
      })
      .from(cadGenerations)
      .where(
        and(
          eq(cadGenerations.fileAssetId, input.fileAssetId),
          eq(cadGenerations.userId, userId)
        )
      )
      .limit(1);

    if (gen?.threadId) {
      await db
        .update(cadThreads)
        .set({ title: name, updatedAt: new Date() })
        .where(
          and(eq(cadThreads.id, gen.threadId), eq(cadThreads.userId, userId))
        );
    } else if (gen) {
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

    revalidatePath("/prometheus");
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

    revalidatePath("/prometheus");
    revalidatePath("/prometheus/eval");
    return { ok: true };
  } catch (error) {
    logError("recordCadFeedback", error);
    return { error: "Could not save feedback." };
  }
}

/**
 * Delete a build from the studio history — removes the generation rows for the
 * thread (root + revisions), best-effort deletes their render/topo R2 objects
 * (docs/text-to-cad/05 §E), and drops the thread row itself once it has no
 * generations left. The underlying library files/assets are left intact (they
 * may be saved/printed); the studio-artifacts cron sweeps stale unsaved ones.
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
    // Capture render/topo keys + thread ids before the rows disappear.
    const rows = await db
      .select({
        id: cadGenerations.id,
        renderStorageKey: cadGenerations.renderStorageKey,
        topoStorageKey: cadGenerations.topoStorageKey,
        threadId: cadGenerations.threadId,
      })
      .from(cadGenerations)
      .where(
        and(inArray(cadGenerations.id, ids), eq(cadGenerations.userId, userId))
      );

    await db
      .delete(cadGenerations)
      .where(
        and(
          inArray(cadGenerations.id, ids),
          eq(cadGenerations.userId, userId)
        )
      );

    // Best-effort R2 cleanup — a failed object delete must not fail the
    // action (the studio-artifacts cron is the safety net).
    const objectKeys = rows.flatMap((r) =>
      [r.renderStorageKey, r.topoStorageKey].filter((k): k is string => !!k)
    );
    await Promise.allSettled(
      objectKeys.map((key) =>
        deleteObject(key).catch((err) =>
          logError("deleteCadBuild.deleteObject", err)
        )
      )
    );

    // Drop thread rows that just lost their last generation (deleting a
    // whole build deletes its thread; deleting a subset leaves it).
    const threadIds = [
      ...new Set(rows.map((r) => r.threadId).filter((t): t is string => !!t)),
    ];
    for (const threadId of threadIds) {
      const [remaining] = await db
        .select({ id: cadGenerations.id })
        .from(cadGenerations)
        .where(eq(cadGenerations.threadId, threadId))
        .limit(1);
      if (!remaining) {
        await db
          .delete(cadThreads)
          .where(
            and(eq(cadThreads.id, threadId), eq(cadThreads.userId, userId))
          );
      }
    }

    revalidatePath("/prometheus");
    return { ok: true };
  } catch (error) {
    logError("deleteCadBuild", error);
    return { error: "Could not delete build." };
  }
}

/**
 * Mint a short-lived download URL for a file's editable STEP source (MTR-196),
 * the "Download STEP (editable CAD)" affordance the studio / file detail /
 * marketplace surfaces call. Returns `{ url: null }` (not an error) when the
 * asset has no STEP — mesh-mode / sdf_kit generations and every non-CAD
 * upload — so the caller renders no dead button.
 *
 * Entitlement mirrors the STL download exactly: `userOwnsFile` grants the
 * creator, org members, project collaborators, and buyers of the listing (or
 * of a project bundling it) — a paying customer's editable source is part of
 * what they bought. Free listings are public. Not gated behind
 * canUseTextToCad: STEP download is a buyer/owner right, not a studio feature.
 */
export async function getCadStepDownloadUrl(input: {
  fileAssetId: string;
}): Promise<{ url: string | null } | { error: string }> {
  const fileAssetId = input.fileAssetId?.trim();
  if (!fileAssetId) return { error: "Not found" };

  try {
    const [asset] = await db
      .select({
        stepStorageKey: fileAssets.stepStorageKey,
        fileId: fileAssets.fileId,
      })
      .from(fileAssets)
      .where(eq(fileAssets.id, fileAssetId))
      .limit(1);
    // Unlinked asset or no B-rep source — nothing to download, not an error.
    if (!asset || !asset.fileId || !asset.stepStorageKey) {
      return { url: null };
    }

    // userId may be null (anon) — userOwnsFile still resolves free listings.
    const { userId } = await auth();
    if (!(await userOwnsFile(userId, asset.fileId))) {
      return { error: "Not found" };
    }

    const url = await generateDownloadUrl(asset.stepStorageKey);
    return { url };
  } catch (error) {
    logError("getCadStepDownloadUrl", error);
    return { error: "Could not prepare download." };
  }
}
