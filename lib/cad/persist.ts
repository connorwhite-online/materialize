import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import { cadGenerations, files, projects, projectFiles } from "@/lib/db/schema";
import { putObject, generateDownloadUrl } from "@/lib/storage";
import { buildListingSlug } from "@/lib/filenames";
import { logError } from "@/lib/logger";
import { createDraftFileForPrint } from "@/app/actions/files";
import { generateThreadTitle } from "./title";
import type { HarnessResult } from "./harness";
import type { CadPart } from "./types";

/** A filename-safe stem from a display name (download names + dedup safety). */
function slugStem(name: string | undefined, fallback: string): string {
  return (
    name?.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || fallback
  );
}

/**
 * Post-harness persistence for a text-to-CAD generation, shared by the
 * non-streaming server action (app/actions/cad-generation.ts) and the
 * streaming route (app/api/cad/generate). Centralizing it keeps the two
 * entry points from drifting: STL -> R2, draft library asset, render -> R2,
 * thread title, and the final row update all live here.
 */

export interface GeneratedPart {
  name: string;
  fileAssetId: string;
  fileSlug: string;
}

export interface PersistedGeneration {
  generationId: string;
  /** The primary printable asset (the first part for an assembly). */
  fileAssetId: string;
  fileSlug: string;
  renderUrl: string | null;
  sourceCode: string;
  /** Non-null only for a root generation (a thread's first turn). */
  title: string | null;
  /** Present (length > 1) when the result was a multi-part assembly. */
  parts?: GeneratedPart[];
  /** Slug of the Project bundling an assembly's parts, when created. */
  projectSlug?: string | null;
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

  // Multi-part assembly: persist each part as its own file under a Project.
  const parts = result.run?.parts;
  if (parts && parts.length > 1) {
    return persistAssembly({
      userId,
      generationId,
      prompt,
      isRoot,
      nameOverride: opts.nameOverride,
      result,
      parts,
    });
  }

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
  const stem = slugStem(displayName, "model");

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

/**
 * Persist a multi-part assembly: upload + mint a draft file per part, bundle
 * them into a Materialize Project, and point the generation at the first part
 * (for the thumbnail/viewer). Parts that fail to persist are skipped rather
 * than failing the whole assembly; an assembly with zero usable parts fails.
 */
async function persistAssembly(opts: {
  userId: string;
  generationId: string;
  prompt: string;
  isRoot: boolean;
  nameOverride?: string;
  result: HarnessResult;
  parts: CadPart[];
}): Promise<PersistedGeneration | PersistError> {
  const { userId, generationId, prompt, isRoot, result, parts } = opts;

  const title = isRoot ? await generateThreadTitle(prompt) : null;
  const baseName = (isRoot ? title : opts.nameOverride)?.trim() || "Assembly";

  const created: (GeneratedPart & { fileId: string | null })[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const stl = p.files.stl;
    if (!stl) continue;
    const bytes = new Uint8Array(Buffer.from(stl, "base64"));
    const stem = slugStem(`${baseName}-${p.name}`, `part-${i + 1}`);
    const storageKey = `uploads/${userId}/${nanoid()}/${stem}.stl`;
    await putObject(storageKey, bytes, "model/stl");
    const draft = await createDraftFileForPrint({
      storageKey,
      originalFilename: `${stem}.stl`,
      format: "stl",
      fileSize: bytes.byteLength,
      displayName: `${baseName} — ${p.name}`,
    });
    if ("error" in draft) {
      logError("persistAssembly.part", new Error(draft.error));
      continue;
    }
    // createDraftFileForPrint returns the asset + slug; resolve the file id
    // (slug is unique) so we can link it into the Project.
    const [f] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.slug, draft.fileSlug), eq(files.userId, userId)))
      .limit(1);
    created.push({
      name: p.name,
      fileAssetId: draft.fileAssetId,
      fileSlug: draft.fileSlug,
      fileId: f?.id ?? null,
    });
  }

  if (created.length === 0) {
    return persistGenerationFailure(
      generationId,
      "Assembly produced no printable parts.",
      result.sourceCode,
      result.attempts
    );
  }

  // Bundle the linkable parts into a Project (private draft, like the files).
  let projectSlug: string | null = null;
  const linkable = created.filter((c) => c.fileId);
  if (linkable.length > 0) {
    try {
      const [project] = await db
        .insert(projects)
        .values({
          userId,
          name: baseName,
          slug: buildListingSlug(baseName, nanoid(6)),
          status: "draft",
          visibility: "private",
        })
        .returning({ slug: projects.slug, id: projects.id });
      await db.insert(projectFiles).values(
        linkable.map((c, idx) => ({
          projectId: project.id,
          fileId: c.fileId as string,
          position: idx,
        }))
      );
      projectSlug = project.slug;
    } catch (err) {
      // A Project is an organizational nicety — the individual part files
      // already exist, so don't fail the generation if bundling trips.
      logError("persistAssembly.project", err);
    }
  }

  // Preview render (best-effort) mirrors the first part / top-level render.
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
      logError("persistAssembly.render", err);
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
      fileAssetId: created[0].fileAssetId,
      renderStorageKey,
      aestheticScore: result.aestheticScore ?? null,
      ...(isRoot ? { title } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cadGenerations.id, generationId));

  return {
    generationId,
    fileAssetId: created[0].fileAssetId,
    fileSlug: created[0].fileSlug,
    renderUrl,
    sourceCode: result.sourceCode,
    title,
    parts: created.map((c) => ({
      name: c.name,
      fileAssetId: c.fileAssetId,
      fileSlug: c.fileSlug,
    })),
    projectSlug,
  };
}
