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
// Read-only imports of the backend building blocks so the no-LLM template
// exec (MTR-190) composes them without reimplementing the persist/sidecar
// path (owned by the backend PR — never edited here).
import { runCadCode } from "@/lib/cad/runner-client";
import {
  persistGenerationSuccess,
  persistGenerationFailure,
} from "@/lib/cad/persist";
import { BREP_OUTPUT_FORMATS, type CadNetworksReport } from "@/lib/cad/types";
import type { HarnessResult } from "@/lib/cad/harness";
import { substituteParams, extractParams } from "@/components/cad/param-diff";
import {
  parseFeatures,
  bindFeatureParamNames,
  substituteFeatureParams,
  spliceStatementSpan,
} from "@/lib/cad/features";
import { completeText } from "@/lib/cad/model-client";
import { extractCode } from "@/lib/cad/prompt";
import { CAD_EXEMPLARS } from "@/lib/cad/knowledge/exemplars";
import {
  checkCadGenerateRateLimit,
  type CadRateLimitResult,
} from "@/app/api/cad/generate/rate-limit";

/**
 * Shared not-ok formatter for the three studio server actions below
 * (runCadTemplate, rerunCadWithParams, reviseCadFeatureStatement) — mirrors
 * the 429 text POST /api/cad/generate returns for the same limiter result
 * (app/api/cad/generate/route.ts), minus the HTTP-specific Retry-After
 * header (there's no response object here to hang it on).
 */
function rateLimitErrorMessage(
  rate: Extract<CadRateLimitResult, { ok: false }>
): string {
  return (
    `You've started ${rate.count} generations in the last ` +
    `${rate.windowMinutes} minutes. Give it a moment and try again.`
  );
}

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

/**
 * Mint a short-lived download URL for a generation's B-rep topology sidecar
 * (MTR-174) — the per-face/edge identity manifest the studio viewer consumes
 * for EXACT picking (binary-search `triRange` → face; real edge polylines
 * incl. smooth-tangent fillet boundaries) instead of the mesh flood-fill
 * fallback. Keyed on the GENERATION (topology is a property of the build's
 * B-rep, persisted on `cadGenerations.topoStorageKey`, not on the file asset).
 *
 * Returns `{ url: null }` (not an error) when the generation has no topology —
 * mesh-mode / sdf_kit builds and legacy rows predating the column — so the
 * viewer silently degrades to flood-fill picking with no dead affordance.
 *
 * Studio-only picking feature: gated behind `canUseTextToCad` and pinned to
 * the caller's own rows (userId in the WHERE), mirroring every other studio
 * action here.
 */
export async function getCadTopoUrl(input: {
  generationId: string;
}): Promise<{ url: string | null } | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  const generationId = input.generationId?.trim();
  if (!generationId) return { error: "Not found" };

  try {
    const [gen] = await db
      .select({ topoStorageKey: cadGenerations.topoStorageKey })
      .from(cadGenerations)
      .where(
        and(
          eq(cadGenerations.id, generationId),
          eq(cadGenerations.userId, userId)
        )
      )
      .limit(1);
    // No row of ours, or no B-rep topology for this build — nothing to pick
    // against, not an error.
    if (!gen || !gen.topoStorageKey) return { url: null };

    const url = await generateDownloadUrl(gen.topoStorageKey);
    return { url };
  } catch (error) {
    logError("getCadTopoUrl", error);
    return { url: null };
  }
}

/** What the studio needs to render a template build as a first-class turn. */
export interface RunCadTemplateResult {
  generationId: string;
  fileAssetId: string;
  renderUrl: string | null;
  sourceCode: string;
  title: string | null;
  parts: { name: string; fileAssetId: string }[];
  projectSlug: string | null;
  remeshed: boolean;
  hasStep: boolean;
}

/**
 * Instantiate a verified exemplar as a real generation with the user's picked
 * parameters — the "Start from a template" path (MTR-190). NO LLM in the loop:
 * we substitute the numbers into the proven source and run it straight through
 * the sidecar, so every result is watertight-by-construction, deterministic,
 * and carries zero marginal model cost (~2s round trip).
 *
 * The result is persisted exactly like any generation (`persistGenerationSuccess`),
 * so threads/revisions/save/print/STEP/topology all work unchanged. We pass
 * `isRoot: false` with a `nameOverride` of the exemplar title on purpose: that
 * is the one persist branch that names the file WITHOUT a title-model call
 * (the LLM the "no LLM / zero cost" invariant forbids on this hot slider path).
 * The thread row is created lazily on the first revision (or reconstructed by
 * the page's legacy grouping on reload) — same lifecycle as an in-session build.
 *
 * Owner-only; gated like every other studio surface.
 */
export async function runCadTemplate(input: {
  exemplarId: string;
  params: Record<string, number>;
}): Promise<RunCadTemplateResult | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  // Per-user frequency backstop (MTR-169): this action drives a real
  // billed sidecar exec just like POST /api/cad/generate, so it must be
  // gated by the same rate limiter — mirrors route.ts's check.
  const rate = await checkCadGenerateRateLimit(userId);
  if (!rate.ok) {
    return { error: rateLimitErrorMessage(rate) };
  }

  const exemplar = CAD_EXEMPLARS.find(
    (e) => e.id === input.exemplarId && e.verified
  );
  // Only VERIFIED exemplars are ever instantiable (the quality guard) — an
  // unverified/unknown id is treated as not found, never run.
  if (!exemplar) return { error: "Template not found." };

  // Sanitize the picked params: finite numbers only, and only names that are
  // actual parameters of this exemplar's source. Anything else is dropped, so
  // a stale/hostile client can't smuggle values into non-parametric lines.
  const params: Record<string, number> = {};
  for (const [name, value] of Object.entries(input.params ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) {
      params[name] = value;
    }
  }
  const source = substituteParams(exemplar.code, params);
  const prompt = `Template: ${exemplar.title}`;

  // Insert the pending row first (mirrors the generate route) so a failed
  // sidecar run still leaves an auditable record rather than a silent drop.
  const [row] = await db
    .insert(cadGenerations)
    .values({
      userId,
      prompt,
      engine: "build123d",
      status: "pending",
    })
    .returning({ id: cadGenerations.id });
  const generationId = row.id;

  try {
    const run = await runCadCode(source, BREP_OUTPUT_FORMATS);
    if (!run.ok) {
      await persistGenerationFailure(
        generationId,
        run.error || "Template build failed.",
        source,
        1
      );
      return { error: "This template couldn't be built. Please try again." };
    }

    const result: HarnessResult = {
      ok: true,
      sourceCode: source,
      attempts: 1,
      run,
      route: `template:${exemplar.id}`,
    };

    const persisted = await persistGenerationSuccess({
      userId,
      generationId,
      prompt,
      // Root: a template instantiation starts a REAL studio thread (named
      // after the exemplar, no title-model call) so the build opens in the
      // studio and is revisable like any other turn — previously
      // isRoot:false with no parent left it threadless and invisible there.
      isRoot: true,
      nameOverride: exemplar.title,
      result,
    });
    if ("error" in persisted) return { error: persisted.error };

    revalidatePath("/prometheus");
    return {
      generationId: persisted.generationId,
      fileAssetId: persisted.fileAssetId,
      renderUrl: persisted.renderUrl,
      sourceCode: persisted.sourceCode,
      title: persisted.title ?? exemplar.title,
      parts: (persisted.parts ?? []).map((p) => ({
        name: p.name,
        fileAssetId: p.fileAssetId,
      })),
      projectSlug: persisted.projectSlug ?? null,
      remeshed: persisted.remeshed ?? false,
      hasStep: persisted.hasStep ?? false,
    };
  } catch (error) {
    logError("runCadTemplate", error);
    await persistGenerationFailure(
      generationId,
      "Template build failed.",
      source,
      1
    ).catch((err) => logError("cad.persistGenerationFailure", err));
    return { error: "Could not build this template. Please try again." };
  }
}

/** Result of a no-LLM param rerun (feature-chip Update). */
export interface RerunCadWithParamsResult {
  generationId: string;
  fileAssetId: string;
  renderUrl: string | null;
  sourceCode: string;
  parentGenerationId: string;
  parts: { name: string; fileAssetId: string }[];
  projectSlug: string | null;
  remeshed: boolean;
  /** Dual-fluid isolation verdict (MTR-179) when circuits were declared. */
  networksReport: CadNetworksReport | null;
  hasStep: boolean;
  features: ReturnType<typeof parseFeatures>;
}

/**
 * Re-run a generation's parametric source with substituted top-level numbers
 * (feature-chip Update). NO LLM: substitute → sidecar → persist as a new
 * revision under the parent. Only names present in the parent's
 * `extractParams` set are accepted — a stale/hostile client can't inject
 * lines. Owner-only; gated like every other studio surface.
 */
export async function rerunCadWithParams(input: {
  generationId: string;
  params: Record<string, number>;
  /**
   * When set, `params` are the feature's CONTROL keys (radius, amount, …)
   * instead of top-level source names: resolution happens server-side
   * against the stored feature (paramNames binding, or a unique numeric
   * literal inside the feature's statement span — MTR-225).
   */
  featureId?: string;
}): Promise<RerunCadWithParamsResult | { error: string }> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  // Per-user frequency backstop (MTR-169): this action drives a real
  // billed sidecar exec just like POST /api/cad/generate, so it must be
  // gated by the same rate limiter — mirrors route.ts's check.
  const rate = await checkCadGenerateRateLimit(userId);
  if (!rate.ok) {
    return { error: rateLimitErrorMessage(rate) };
  }

  const parentId = input.generationId?.trim();
  if (!parentId) return { error: "Not found" };

  const [parent] = await db
    .select({
      id: cadGenerations.id,
      sourceCode: cadGenerations.sourceCode,
      threadId: cadGenerations.threadId,
      status: cadGenerations.status,
      engine: cadGenerations.engine,
      title: cadGenerations.title,
      features: cadGenerations.features,
    })
    .from(cadGenerations)
    .where(
      and(eq(cadGenerations.id, parentId), eq(cadGenerations.userId, userId))
    )
    .limit(1);

  if (!parent || parent.status !== "succeeded" || !parent.sourceCode) {
    return { error: "Generation not found." };
  }

  let source: string;
  let prompt: string;
  if (input.featureId) {
    // Feature-scoped edit (MTR-225): re-derive every binding from OUR copy of
    // source + features — the client's draft can only move numbers that sit
    // in verified positions (a bound top-level name, or the single matching
    // literal inside the feature's own statement span).
    const features = bindFeatureParamNames(
      parseFeatures(parent.features),
      parent.sourceCode
    );
    const feature = features.find((f) => f.id === input.featureId);
    if (!feature) return { error: "Feature not found." };
    const draft: Record<string, number> = {};
    for (const [key, value] of Object.entries(input.params ?? {})) {
      if (key in feature.params && typeof value === "number" && Number.isFinite(value)) {
        draft[key] = value;
      }
    }
    const substituted = substituteFeatureParams(parent.sourceCode, feature, draft);
    if (!substituted) return { error: "No editable parameters to apply." };
    source = substituted.source;
    const changed = substituted.applied
      .map((key) => `${key} ${feature.params[key]} → ${draft[key]}`)
      .slice(0, 3);
    prompt = `Update ${feature.label}: ${changed.join(" · ")}`;
  } else {
    // Sanitize: finite numbers only, and only names that are real top-level
    // params of this source. Unknown keys are dropped.
    const allowed = extractParams(parent.sourceCode);
    const params: Record<string, number> = {};
    for (const [name, value] of Object.entries(input.params ?? {})) {
      if (
        name in allowed &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        params[name] = value;
      }
    }
    if (Object.keys(params).length === 0) {
      return { error: "No editable parameters to apply." };
    }

    source = substituteParams(parent.sourceCode, params);
    // Diff summary for the revision prompt line shown in history.
    const changed = Object.entries(params)
      .filter(([name, v]) => allowed[name] !== v)
      .map(([name, v]) => `${name} ${allowed[name]} → ${v}`)
      .slice(0, 3);
    prompt =
      changed.length > 0
        ? `Update params: ${changed.join(" · ")}`
        : "Update params";
  }

  // Thread title for the revision's file name (root-row title fallback).
  let nameOverride: string | undefined;
  if (parent.threadId) {
    const [thread] = await db
      .select({ title: cadThreads.title })
      .from(cadThreads)
      .where(eq(cadThreads.id, parent.threadId))
      .limit(1);
    nameOverride = thread?.title ?? parent.title ?? undefined;
  } else {
    nameOverride = parent.title ?? undefined;
  }

  const [row] = await db
    .insert(cadGenerations)
    .values({
      userId,
      prompt,
      engine: parent.engine || "build123d",
      status: "pending",
      parentGenerationId: parent.id,
      threadId: parent.threadId ?? null,
    })
    .returning({ id: cadGenerations.id });
  const generationId = row.id;

  try {
    const run = await runCadCode(source, BREP_OUTPUT_FORMATS, undefined, {
      engine: parent.engine || "build123d",
    });
    if (!run.ok) {
      await persistGenerationFailure(
        generationId,
        run.error || "Param update failed.",
        source,
        1
      );
      return {
        error:
          run.error ||
          "Those parameters couldn't be built. Try different values or revise in chat.",
      };
    }

    const result: HarnessResult = {
      ok: true,
      sourceCode: source,
      attempts: 1,
      run,
      route: "param-rerun",
    };

    const persisted = await persistGenerationSuccess({
      userId,
      generationId,
      prompt,
      isRoot: false,
      nameOverride,
      result,
    });
    if ("error" in persisted) return { error: persisted.error };

    revalidatePath("/prometheus");
    return {
      generationId: persisted.generationId,
      fileAssetId: persisted.fileAssetId,
      renderUrl: persisted.renderUrl,
      sourceCode: persisted.sourceCode,
      parentGenerationId: parent.id,
      parts: (persisted.parts ?? []).map((p) => ({
        name: p.name,
        fileAssetId: p.fileAssetId,
      })),
      projectSlug: persisted.projectSlug ?? null,
      remeshed: persisted.remeshed ?? false,
      networksReport: persisted.networksReport ?? null,
      hasStep: persisted.hasStep ?? false,
      features: parseFeatures(persisted.features),
    };
  } catch (error) {
    logError("rerunCadWithParams", error);
    await persistGenerationFailure(
      generationId,
      "Param update failed.",
      source,
      1
    ).catch((err) => logError("cad.persistGenerationFailure", err));
    return { error: "Could not apply those parameters. Please try again." };
  }
}

/**
 * Statement-repair contract for stmt-edit (MTR-225). Deliberately NOT the
 * full SYSTEM_PROMPT: the model is editing ONE statement of a script that
 * already builds — the FlexCAD/CAD-Editor locate-then-infill pattern. The
 * splice + sidecar re-run is the correctness gate.
 */
const STMT_EDIT_SYSTEM = `You are editing ONE statement of a working build123d Python script.
Rules:
- Output ONLY a single Python code block containing the REPLACEMENT for the target statement. No prose.
- Replace only the target statement; everything else in the script is pinned and will be kept verbatim.
- Preserve the target's exact indentation so the replacement splices cleanly into its block.
- Keep the same variable names and selector style (select from the named intermediate that created the geometry, not global part-wide queries).
- Stay parametric: if the statement reads a top-level parameter, adjust the call — do not inline new magic numbers unless the change requires one.
- The replacement should stay a small, local edit (a few lines) — if the request cannot be satisfied by editing this statement alone, output the closest local edit that moves toward it.`;

/**
 * Result of a statement-scoped LLM edit. `fallback: true` tells the studio
 * the request should be retried as a normal chat revision (whole-script).
 */
export type ReviseCadFeatureStatementResult =
  | RerunCadWithParamsResult
  | { error: string; fallback?: boolean };

/**
 * Statement-scoped LLM repair (MTR-225): "make this fillet bigger" addressed
 * at one feature chip edits ONLY that feature's statement span — the rest of
 * the script is pinned verbatim. One small model call + one sidecar run; on
 * any failure the caller falls back to the normal whole-script revision.
 */
export async function reviseCadFeatureStatement(input: {
  generationId: string;
  featureId: string;
  instruction: string;
}): Promise<ReviseCadFeatureStatementResult> {
  const { userId } = await auth();
  if (!userId) return { error: "Unauthorized" };

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) return { error: "Not found" };

  // Per-user frequency backstop (MTR-169): this action drives a model
  // completion + a real billed sidecar exec just like
  // POST /api/cad/generate, so it must be gated by the same rate limiter —
  // mirrors route.ts's check.
  const rate = await checkCadGenerateRateLimit(userId);
  if (!rate.ok) {
    return { error: rateLimitErrorMessage(rate) };
  }

  const parentId = input.generationId?.trim();
  const instruction = input.instruction?.trim();
  if (!parentId || !instruction) return { error: "Not found" };
  if (instruction.length > 500) {
    return { error: "Keep step instructions under 500 characters." };
  }

  const [parent] = await db
    .select({
      id: cadGenerations.id,
      sourceCode: cadGenerations.sourceCode,
      threadId: cadGenerations.threadId,
      status: cadGenerations.status,
      engine: cadGenerations.engine,
      title: cadGenerations.title,
      features: cadGenerations.features,
    })
    .from(cadGenerations)
    .where(
      and(eq(cadGenerations.id, parentId), eq(cadGenerations.userId, userId))
    )
    .limit(1);

  if (!parent || parent.status !== "succeeded" || !parent.sourceCode) {
    return { error: "Generation not found." };
  }
  const feature = parseFeatures(parent.features).find(
    (f) => f.id === input.featureId
  );
  if (!feature?.span) {
    // No span recorded (older generation, or resolution failed) — the
    // statement-scoped path can't run; the studio falls back to chat.
    return { error: "This step can't be edited in place.", fallback: true };
  }

  const sourceLines = parent.sourceCode.split("\n");
  const [start, end] = feature.span;
  const numbered = sourceLines
    .map((l, i) => {
      const n = i + 1;
      const mark = n >= start && n <= end ? ">>>" : "   ";
      return `${mark} ${String(n).padStart(4)} | ${l}`;
    })
    .join("\n");
  const editPrompt = [
    `Script (lines marked >>> are the TARGET statement — step "${feature.label}"):`,
    "```python",
    numbered,
    "```",
    `Requested change to this step: ${instruction}`,
    "Output the replacement for the marked statement only.",
  ].join("\n\n");

  let replacement: string;
  try {
    const text = await completeText({
      system: STMT_EDIT_SYSTEM,
      prompt: editPrompt,
      role: "repair",
    });
    replacement = extractCode(text);
  } catch (error) {
    logError("reviseCadFeatureStatement.model", error);
    return { error: "Couldn't generate the edit.", fallback: true };
  }
  // A statement edit is a few lines; a big blob means the model rewrote the
  // script — reject and fall back rather than splicing an unknown quantity.
  const spanLen = end - start + 1;
  if (!replacement || replacement.split("\n").length > Math.max(spanLen + 8, 12)) {
    return { error: "Edit came back too large for this step.", fallback: true };
  }

  const source = spliceStatementSpan(parent.sourceCode, feature.span, replacement);
  if (!source) return { error: "This step can't be edited in place.", fallback: true };

  const prompt = `Edit ${feature.label}: ${instruction}`;
  let nameOverride: string | undefined;
  if (parent.threadId) {
    const [thread] = await db
      .select({ title: cadThreads.title })
      .from(cadThreads)
      .where(eq(cadThreads.id, parent.threadId))
      .limit(1);
    nameOverride = thread?.title ?? parent.title ?? undefined;
  } else {
    nameOverride = parent.title ?? undefined;
  }

  const [row] = await db
    .insert(cadGenerations)
    .values({
      userId,
      prompt,
      engine: parent.engine || "build123d",
      status: "pending",
      parentGenerationId: parent.id,
      threadId: parent.threadId ?? null,
    })
    .returning({ id: cadGenerations.id });
  const generationId = row.id;

  try {
    const run = await runCadCode(source, BREP_OUTPUT_FORMATS, undefined, {
      engine: parent.engine || "build123d",
    });
    if (!run.ok) {
      await persistGenerationFailure(
        generationId,
        run.error || "Step edit failed.",
        source,
        1
      );
      // The spliced script didn't build — hand the request to the normal
      // whole-script revision path instead of iterating here.
      return {
        error: run.error || "That edit didn't build.",
        fallback: true,
      };
    }

    const result: HarnessResult = {
      ok: true,
      sourceCode: source,
      attempts: 1,
      run,
      route: "stmt-edit",
    };
    const persisted = await persistGenerationSuccess({
      userId,
      generationId,
      prompt,
      isRoot: false,
      nameOverride,
      result,
    });
    if ("error" in persisted) return { error: persisted.error };

    revalidatePath("/prometheus");
    return {
      generationId: persisted.generationId,
      fileAssetId: persisted.fileAssetId,
      renderUrl: persisted.renderUrl,
      sourceCode: persisted.sourceCode,
      parentGenerationId: parent.id,
      parts: (persisted.parts ?? []).map((p) => ({
        name: p.name,
        fileAssetId: p.fileAssetId,
      })),
      projectSlug: persisted.projectSlug ?? null,
      remeshed: persisted.remeshed ?? false,
      networksReport: persisted.networksReport ?? null,
      hasStep: persisted.hasStep ?? false,
      features: parseFeatures(persisted.features),
    };
  } catch (error) {
    logError("reviseCadFeatureStatement", error);
    await persistGenerationFailure(
      generationId,
      "Step edit failed.",
      source,
      1
    ).catch((err) => logError("cad.persistGenerationFailure", err));
    return { error: "Could not apply that edit.", fallback: true };
  }
}
