import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { putObject, generateDownloadUrl } from "@/lib/storage";
import { logError } from "@/lib/logger";
import { createDraftFileForPrint } from "@/app/actions/files";
import { generateThreadTitle } from "./title";
import type { HarnessResult } from "./harness";

/**
 * Post-harness persistence for a text-to-CAD generation, shared by the
 * non-streaming server action (app/actions/cad-generation.ts) and the
 * streaming route (app/api/cad/generate). Centralizing it keeps the two
 * entry points from drifting: STL -> R2, draft library asset, render -> R2,
 * thread title, and the final row update all live here.
 */

export interface PersistedGeneration {
  generationId: string;
  fileAssetId: string;
  fileSlug: string;
  renderUrl: string | null;
  sourceCode: string;
  /** Non-null only for a root generation (a thread's first turn). */
  title: string | null;
}

export interface PersistError {
  error: string;
  generationId: string;
}

/** Mark a generation row failed and return the error envelope. */
export async function persistGenerationFailure(
  generationId: string,
  message: string,
  sourceCode = "",
  attempts = 0
): Promise<PersistError> {
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
}

/**
 * Persist a successful harness result: upload the STL under the caller's
 * prefix, mint a printable draft asset, stash the preview render, title the
 * thread (root only), and flip the row to `succeeded`. Returns a
 * PersistError (and marks the row failed) if a required step can't complete.
 */
export async function persistGenerationSuccess(opts: {
  userId: string;
  generationId: string;
  prompt: string;
  /** True for a thread's first turn — only then do we generate a title. */
  isRoot: boolean;
  /**
   * Name to give a revision's file (the thread's existing title, supplied by
   * the caller). Ignored for root turns, which name the file from the freshly
   * generated title.
   */
  nameOverride?: string;
  result: HarnessResult;
}): Promise<PersistedGeneration | PersistError> {
  const { userId, generationId, prompt, isRoot, result } = opts;

  const stlB64 = result.run?.files.stl;
  if (!stlB64) {
    return persistGenerationFailure(
      generationId,
      "Model produced no printable output.",
      result.sourceCode,
      result.attempts
    );
  }

  const bytes = new Uint8Array(Buffer.from(stlB64, "base64"));
  const storageKey = `uploads/${userId}/${nanoid()}/model.stl`;

  // Title the thread (root only, best-effort) and upload the STL together —
  // they're independent, so the model call doesn't add latency on top of the
  // R2 write. createDraftFileForPrint needs the title (for the name) and the
  // upload (for the key), so we await both before it.
  const [title] = await Promise.all([
    isRoot ? generateThreadTitle(prompt) : Promise.resolve(null),
    putObject(storageKey, bytes, "model/stl"),
  ]);

  const displayName = (isRoot ? title : opts.nameOverride)?.trim() || undefined;
  // A filename-safe stem keeps the download name nice and avoids the
  // (filename, size) dedup colliding two different models both called
  // "model.stl".
  const stem =
    displayName?.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "model";

  const draft = await createDraftFileForPrint({
    storageKey,
    originalFilename: `${stem}.stl`,
    format: "stl",
    fileSize: bytes.byteLength,
    displayName,
  });
  if ("error" in draft) {
    return persistGenerationFailure(
      generationId,
      draft.error,
      result.sourceCode,
      result.attempts
    );
  }

  // Store the preview render in R2 (not inline in the DB) and mint a
  // short-lived URL for immediate display. Best-effort: a render failure
  // must not fail an otherwise-good generation.
  let renderStorageKey: string | null = null;
  let renderUrl: string | null = null;
  if (result.run?.renderPng) {
    try {
      renderStorageKey = `cad-renders/${userId}/${nanoid()}.png`;
      await putObject(
        renderStorageKey,
        new Uint8Array(Buffer.from(result.run.renderPng, "base64")),
        "image/png"
      );
      renderUrl = await generateDownloadUrl(renderStorageKey);
    } catch (err) {
      logError("persistGenerationSuccess.render", err);
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
      aestheticScore: result.aestheticScore ?? null,
      ...(isRoot ? { title } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cadGenerations.id, generationId));

  return {
    generationId,
    fileAssetId: draft.fileAssetId,
    fileSlug: draft.fileSlug,
    renderUrl,
    sourceCode: result.sourceCode,
    title,
  };
}
