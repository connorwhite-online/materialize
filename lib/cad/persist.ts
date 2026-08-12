import "server-only";

import { gzipSync } from "node:zlib";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/lib/db";
import {
  cadGenerations,
  cadThreads,
  fileAssets,
  files,
  projects,
  projectFiles,
} from "@/lib/db/schema";
import { putObject, generateDownloadUrl } from "@/lib/storage";
import { buildListingSlug } from "@/lib/filenames";
import { logError } from "@/lib/logger";
import { createDraftFileForPrint } from "@/app/actions/files";
import { generateThreadTitle } from "./title";
import { harnessConfigFingerprint } from "./fingerprint";
import type { HarnessResult } from "./harness";
import type { DimensionCheckResult } from "./dimension-check";
import { bindFeatureParamNames, parseFeatures } from "./features";
import type { CadProcess } from "./knowledge/dfm";
import type { CadFeature, CadNetworksReport, CadPart } from "./types";

/** A filename-safe stem from a display name (download names + dedup safety). */
function slugStem(name: string | undefined, fallback: string): string {
  return (
    name?.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || fallback
  );
}

/**
 * Optional result fields owned by in-flight harness work (design brief +
 * per-dimension aesthetic scores; both jsonb passthroughs). Read
 * structurally and defensively so persist compiles and no-ops whether or
 * not HarnessResult has grown them yet — only set when present, so absent
 * fields never overwrite a column with null.
 */
function resultExtras(
  result: HarnessResult
): { aestheticDims?: unknown; brief?: unknown } {
  const r = result as HarnessResult & {
    aestheticDims?: unknown;
    brief?: unknown;
  };
  return {
    ...(r.aestheticDims !== undefined ? { aestheticDims: r.aestheticDims } : {}),
    ...(r.brief !== undefined ? { brief: r.brief } : {}),
  };
}

/**
 * Dimension-contract results for the row (MTR-197 annotation layer): the
 * harness's deterministic per-target verdicts, persisted verbatim so the
 * studio renders the dimension layer + verified chip across reloads. Null
 * when the brief carried no targets — the column then stays untouched.
 */
function runDimensionChecks(
  result: HarnessResult
): DimensionCheckResult[] | null {
  const checks = result.dimensionChecks;
  return checks && checks.length > 0 ? checks : null;
}

/** IANA type for a STEP (ISO 10303-21) B-rep exchange file. */
const STEP_CONTENT_TYPE = "model/step";

/**
 * Persist the editable B-rep STEP source (MTR-196) beside the printable STL:
 * `uploads/{userId}/{id}/model.step` in the SAME folder as the mesh, then
 * stamp its key onto the fileAsset (fileAssets.stepStorageKey) so the file
 * detail / studio / marketplace surfaces can offer "Download STEP (editable
 * CAD)". Best-effort: STEP is a bonus artifact, so a failure here must never
 * fail an otherwise-good generation — the printable STL already committed.
 * No-ops (returns false) when the run carried no STEP bytes (mesh-mode /
 * sdf_kit), which keeps the download affordance graceful (no dead button).
 */
async function persistStepForAsset(opts: {
  fileAssetId: string;
  /** The STL's storage key — STEP lands in the same folder, `.stl`→`.step`. */
  stlStorageKey: string;
  /** Base64 STEP bytes from the run/part payload (undefined = no B-rep). */
  stepB64: string | undefined;
}): Promise<boolean> {
  const { fileAssetId, stlStorageKey, stepB64 } = opts;
  if (!stepB64) return false;
  try {
    const stepStorageKey = stlStorageKey.replace(/\.stl$/i, ".step");
    // STEP is verbose ISO 10303-21 TEXT — a filleted assembly runs tens of
    // MB raw, and R2's S3 endpoint is not edge-cached, so raw transfer was
    // the "Download STEP hangs forever" bottleneck. Stored gzipped (5-10x
    // smaller) with Content-Encoding so browsers decode transparently on
    // the presigned GET; pre-existing uncompressed objects still serve fine.
    await putObject(
      stepStorageKey,
      new Uint8Array(gzipSync(Buffer.from(stepB64, "base64"))),
      STEP_CONTENT_TYPE,
      { contentEncoding: "gzip" }
    );
    await db
      .update(fileAssets)
      .set({ stepStorageKey })
      .where(eq(fileAssets.id, fileAssetId));
    return true;
  } catch (err) {
    logError("persist.step", err);
    return false;
  }
}

/**
 * The sidecar attaches a B-rep topology manifest (per-face tessellation with
 * face/edge identity — MTR-174 Phase 2, `cad-runner/app.py` `_export_topology`)
 * on the run payload at `run.topo` when "topo" is among the requested formats.
 * Read structurally/defensively: absent on mesh-mode / older sidecars /
 * export failure. Live B-rep runs request ["stl","step","topo"].
 *
 * Addressing scheme (spec item 3): the manifest is stored verbatim, and
 * face/edge selector refs are the manifest's own per-face / per-edge identity
 * indices, which by the sidecar's shipped-STL-matches-triRange invariant index
 * exactly the triangles of the STL we persist. Consumers (MTR-174 viewer
 * picking, MTR-40 measure) resolve a picked triangle → face via triRange and
 * address it stably across a session from this cached manifest without
 * reopening the kernel.
 */
function runTopology(result: HarnessResult): unknown {
  return result.run?.topo ?? null;
}

/**
 * Construction features from the sidecar (feature-chip UX). Bind any
 * unbound numeric params to uniquely-matching top-level source names so
 * Reset/Update works even when the runner couldn't resolve them.
 */
function runFeatures(result: HarnessResult): CadFeature[] | null {
  const raw = result.run?.features;
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const parsed = parseFeatures(raw);
  if (parsed.length === 0) return null;
  return bindFeatureParamNames(parsed, result.sourceCode ?? "");
}

/**
 * Store the topology manifest under the GC-swept `cad-topo/` prefix and return
 * its key for the generation row (cadGenerations.topoStorageKey). Best-effort:
 * a failure leaves topoStorageKey null (the manifest is re-derivable from the
 * STEP), and the cleanup-studio-artifacts cron already sweeps orphaned
 * `cad-topo/` objects.
 */
async function persistTopology(
  userId: string,
  topo: unknown
): Promise<string | null> {
  if (topo === null || topo === undefined) return null;
  try {
    const key = `cad-topo/${userId}/${nanoid()}.json`;
    await putObject(
      key,
      new Uint8Array(Buffer.from(JSON.stringify(topo), "utf-8")),
      "application/json"
    );
    return key;
  } catch (err) {
    logError("persist.topology", err);
    return null;
  }
}

/**
 * Wire the sidecar preview render (PNG) to the file's library thumbnail
 * (MTR-50). The render is already stored under `cad-renders/` for the studio
 * history; this ALSO writes it to the file-scoped `thumbnails/{fileId}.webp`
 * key the thumbnails route serves and records `/api/thumbnails/{fileId}` on
 * files.thumbnailUrl, so a promoted studio file shows real geometry on library
 * / profile cards instead of a blank tile. Best-effort and graceful: no render
 * (bare-macOS sidecar has no headless GL) → thumbnailUrl stays null → the
 * route serves a placeholder. deleteFileListing already scrubs
 * `thumbnails/{fileId}.webp` on hard-delete, so this adds no new orphan.
 */
async function wireThumbnail(
  fileId: string | null,
  renderPngB64: string | undefined
): Promise<void> {
  if (!fileId || !renderPngB64) return;
  try {
    await putObject(
      `thumbnails/${fileId}.webp`,
      new Uint8Array(Buffer.from(renderPngB64, "base64")),
      "image/png"
    );
    await db
      .update(files)
      .set({ thumbnailUrl: `/api/thumbnails/${fileId}` })
      .where(eq(files.id, fileId));
  } catch (err) {
    logError("persist.thumbnail", err);
  }
}

/** Resolve a file's id from its (unique) slug, scoped to the owner. */
async function fileIdForSlug(
  slug: string,
  userId: string
): Promise<string | null> {
  const [f] = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.slug, slug), eq(files.userId, userId)))
    .limit(1);
  return f?.id ?? null;
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
  /** True when this part carried an editable STEP source (MTR-196). */
  hasStep?: boolean;
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
  /** True when the result was voxel-remeshed (an approximation). */
  remeshed?: boolean;
  /**
   * Dual-fluid isolation verdict (MTR-179) when the run declared fluid
   * circuits; null/absent for parts without them (the overwhelming default).
   */
  networksReport?: CadNetworksReport | null;
  /**
   * True when an editable STEP source was persisted for the primary asset
   * (MTR-196) — lets the studio show "Download STEP (editable CAD)" without a
   * round-trip. Absent/false for mesh-mode / sdf_kit (no B-rep).
   */
  hasStep?: boolean;
  /** Construction features for feature chips (empty when none). */
  features?: CadFeature[];
  /**
   * Dimension-contract verdicts (MTR-197) for the studio's annotation layer,
   * threaded so the layer + verified chip render at first paint. Empty when
   * the brief carried no targets.
   */
  dimensionChecks?: DimensionCheckResult[];
}

export interface PersistError {
  error: string;
  generationId: string;
}

/**
 * Thread linkage (docs/text-to-cad/05 §A), resolved entirely inside the
 * persist layer so the action/route/jobs callers stay thread-unaware.
 * Called only for SUCCESSFUL generations, right before the final row
 * update:
 *
 *   - Root generations create the cadThreads row (title = the freshly
 *     generated thread title; root/active generation = this one).
 *   - Revisions inherit the parent's threadId and bump the thread's
 *     activeGenerationId/updatedAt. For a legacy parent that predates
 *     cad_threads (threadId NULL), a thread is created lazily adopting
 *     the parent as root; scripts/backfill-cad-threads.ts covers deeper
 *     pre-migration chains.
 *
 * Best-effort by contract: thread bookkeeping must never fail an
 * otherwise-good generation — every error is logged and null returned
 * (the generation simply stays on the legacy read path).
 */
async function ensureThreadForGeneration(opts: {
  userId: string;
  generationId: string;
  isRoot: boolean;
  /** Freshly generated thread title (root turns only; null elsewhere). */
  title: string | null;
}): Promise<string | null> {
  const { userId, generationId, isRoot, title } = opts;
  try {
    if (isRoot) {
      const [thread] = await db
        .insert(cadThreads)
        .values({
          userId,
          title,
          rootGenerationId: generationId,
          activeGenerationId: generationId,
        })
        .returning({ id: cadThreads.id });
      return thread?.id ?? null;
    }

    // Revision: read this row's parent pointer, then the parent's thread.
    const [row] = await db
      .select({
        threadId: cadGenerations.threadId,
        parentGenerationId: cadGenerations.parentGenerationId,
      })
      .from(cadGenerations)
      .where(eq(cadGenerations.id, generationId))
      .limit(1);
    if (!row) return null;

    let threadId = row.threadId ?? null;
    if (!threadId && row.parentGenerationId) {
      const [parent] = await db
        .select({
          id: cadGenerations.id,
          threadId: cadGenerations.threadId,
          title: cadGenerations.title,
        })
        .from(cadGenerations)
        .where(
          and(
            eq(cadGenerations.id, row.parentGenerationId),
            eq(cadGenerations.userId, userId)
          )
        )
        .limit(1);
      if (!parent) return null;

      if (parent.threadId) {
        threadId = parent.threadId;
      } else {
        // Legacy parent with no thread: create one lazily, adopting the
        // parent as root (its title, when it was a root row, comes along).
        const [thread] = await db
          .insert(cadThreads)
          .values({
            userId,
            title: parent.title,
            rootGenerationId: parent.id,
            activeGenerationId: generationId,
          })
          .returning({ id: cadThreads.id });
        if (!thread) return null;
        await db
          .update(cadGenerations)
          .set({ threadId: thread.id, updatedAt: new Date() })
          .where(eq(cadGenerations.id, parent.id));
        return thread.id;
      }
    }
    if (!threadId) return null;

    // A successful revision becomes the thread's active version.
    await db
      .update(cadThreads)
      .set({ activeGenerationId: generationId, updatedAt: new Date() })
      .where(and(eq(cadThreads.id, threadId), eq(cadThreads.userId, userId)));
    return threadId;
  } catch (err) {
    logError("persist.ensureThreadForGeneration", err);
    return null;
  }
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
   * Name to give the file: a revision's existing thread title, or — on a
   * ROOT turn — a caller-known name (template builds) that both titles the
   * thread and skips the title-model call. Roots without it get an
   * agent-written title as before.
   */
  nameOverride?: string;
  /** Target process this generation built for (MTR-171), stamped on the fingerprint. */
  process?: CadProcess | null;
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
      process: opts.process,
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
    // Root turns get an agent-written title UNLESS the caller already has
    // the right name (template instantiation: the exemplar's own title) —
    // a caller-specified name beats a model guess and skips the call.
    isRoot
      ? opts.nameOverride
        ? Promise.resolve(opts.nameOverride)
        : generateThreadTitle(prompt)
      : Promise.resolve(null),
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
    // Studio provenance: invisible on library surfaces while draft
    // (docs/text-to-cad/05 §B), promoted on Save or print order.
    source: "studio",
  });
  if ("error" in draft) {
    return persistGenerationFailure(
      generationId,
      draft.error,
      result.sourceCode,
      result.attempts
    );
  }

  // Editable STEP source (MTR-196), topology manifest (MTR-174 substrate), and
  // preview render are independent best-effort side artifacts — run them
  // together so they don't stack latency on the hot path. Each helper swallows
  // + logs its own failure so none can fail an otherwise-good generation.
  let renderStorageKey: string | null = null;
  let renderUrl: string | null = null;
  const [hasStep, topoStorageKey] = await Promise.all([
    persistStepForAsset({
      fileAssetId: draft.fileAssetId,
      stlStorageKey: storageKey,
      stepB64: result.run?.files.step,
    }),
    persistTopology(userId, runTopology(result)),
    // Store the preview render in R2 (not inline in the DB) for the studio
    // history and mint a short-lived URL for immediate display.
    (async () => {
      if (!result.run?.renderPng) return;
      try {
        const key = `cad-renders/${userId}/${nanoid()}.png`;
        await putObject(
          key,
          new Uint8Array(Buffer.from(result.run.renderPng, "base64")),
          "image/png"
        );
        renderStorageKey = key;
        renderUrl = await generateDownloadUrl(key);
      } catch (err) {
        logError("persistGenerationSuccess.render", err);
        renderStorageKey = null;
        renderUrl = null;
      }
    })(),
  ]);

  // Thread linkage last — only reached on success, so failed generations
  // never mint (or bump) a thread.
  const threadId = await ensureThreadForGeneration({
    userId,
    generationId,
    isRoot,
    title,
  });

  await db
    .update(cadGenerations)
    .set({
      status: "succeeded",
      sourceCode: result.sourceCode,
      attempts: result.attempts,
      fileAssetId: draft.fileAssetId,
      renderStorageKey,
      // B-rep topology sidecar key (MTR-174) when the run carried a manifest;
      // null otherwise (re-derivable from the STEP). GC-swept via cad-topo/.
      topoStorageKey,
      // Construction features for feature chips (null when none / mesh-mode).
      features: runFeatures(result),
      aestheticScore: result.aestheticScore ?? null,
      // Remesh is a recorded decision (docs/text-to-cad/02 §C) — persist
      // whether the printable mesh came from the lossy voxel fallback so
      // the eval scorecard can report a remesh rate.
      remeshed: result.run?.remeshed ?? false,
      // Dual-fluid isolation verdict (MTR-179) when the run declared fluid
      // circuits — drives the studio isolation badge across reloads.
      networksReport: result.run?.checks?.networks ?? null,
      // Dimension-contract verdicts (MTR-197) — drive the studio's dimension
      // annotation layer + verified chip across reloads.
      dimensionChecks: runDimensionChecks(result),
      // Treatment beside the outcome: which harness config ran (attribution),
      // including the target process this build was guided for (MTR-171).
      configFingerprint: harnessConfigFingerprint(result.route, opts.process),
      ...resultExtras(result),
      // The thread owns the title going forward (root-row title is the
      // legacy-read fallback) — set both while readers migrate.
      ...(isRoot ? { title } : {}),
      ...(threadId ? { threadId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cadGenerations.id, generationId));

  // Wire the render to the library card thumbnail (MTR-50). Done after the
  // generation row is safely committed and only when there's a render to wire,
  // so a thumbnail hiccup never delays the printable result and the file-id
  // lookup is skipped entirely on renderless (bare-macOS) runs.
  if (result.run?.renderPng) {
    await wireThumbnail(
      await fileIdForSlug(draft.fileSlug, userId),
      result.run.renderPng
    );
  }

  return {
    generationId,
    fileAssetId: draft.fileAssetId,
    fileSlug: draft.fileSlug,
    renderUrl,
    hasStep,
    sourceCode: result.sourceCode,
    title,
    remeshed: result.run?.remeshed ?? false,
    networksReport: result.run?.checks?.networks ?? null,
    features: runFeatures(result) ?? [],
    dimensionChecks: runDimensionChecks(result) ?? [],
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
  process?: CadProcess | null;
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
    try {
      await putObject(storageKey, bytes, "model/stl");
    } catch (err) {
      // A mid-loop R2 failure must not propagate: that would discard the
      // in-memory `created` array and orphan the parts already committed
      // (files/fileAssets rows + R2 objects from 0..i-1, now unlinked to any
      // generation/Project). Skip this part like a failed draft instead.
      logError("persistAssembly.upload", err);
      continue;
    }
    const draft = await createDraftFileForPrint({
      storageKey,
      originalFilename: `${stem}.stl`,
      format: "stl",
      fileSize: bytes.byteLength,
      displayName: `${baseName} — ${p.name}`,
      // Studio provenance — same library invisibility as single-part
      // drafts (docs/text-to-cad/05 §B).
      source: "studio",
    });
    if ("error" in draft) {
      logError("persistAssembly.part", new Error(draft.error));
      continue;
    }
    // createDraftFileForPrint returns the asset + slug; resolve the file id
    // (slug is unique) so we can link it into the Project.
    const fileId = await fileIdForSlug(draft.fileSlug, userId);
    // Editable STEP source per part (MTR-196) — each part is a real
    // individual file, so each gets its own downloadable B-rep.
    const hasStep = await persistStepForAsset({
      fileAssetId: draft.fileAssetId,
      stlStorageKey: storageKey,
      stepB64: p.files.step,
    });
    created.push({
      name: p.name,
      fileAssetId: draft.fileAssetId,
      fileSlug: draft.fileSlug,
      fileId,
      hasStep,
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
  let projectId: string | null = null;
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
      projectId = project.id;
    } catch (err) {
      // A Project is an organizational nicety — the individual part files
      // already exist, so don't fail the generation if bundling trips.
      logError("persistAssembly.project", err);
    }
  }

  // Preview render (mirrors the first part / top-level render), library
  // thumbnail on the PRIMARY part's card (MTR-50), and the assembly-level
  // topology manifest (MTR-174) — independent best-effort side artifacts, run
  // together. Per-part topology isn't emitted by the sidecar (payload size), so
  // the manifest is the top-level/primary one.
  let renderStorageKey: string | null = null;
  let renderUrl: string | null = null;
  const [topoStorageKey] = await Promise.all([
    persistTopology(userId, runTopology(result)),
    wireThumbnail(created[0].fileId, result.run?.renderPng),
    (async () => {
      if (!result.run?.renderPng) return;
      try {
        const key = `cad-renders/${userId}/${nanoid()}.png`;
        await putObject(
          key,
          new Uint8Array(Buffer.from(result.run.renderPng, "base64")),
          "image/png"
        );
        renderStorageKey = key;
        renderUrl = await generateDownloadUrl(key);
      } catch (err) {
        logError("persistAssembly.render", err);
        renderStorageKey = null;
        renderUrl = null;
      }
    })(),
  ]);

  // Thread linkage last — only reached on success (zero-part assemblies
  // bailed above), so failed generations never mint a thread.
  const threadId = await ensureThreadForGeneration({
    userId,
    generationId,
    isRoot,
    title,
  });

  await db
    .update(cadGenerations)
    .set({
      status: "succeeded",
      sourceCode: result.sourceCode,
      attempts: result.attempts,
      fileAssetId: created[0].fileAssetId,
      projectId,
      renderStorageKey,
      topoStorageKey,
      // Assemblies: features from the primary solid when the sidecar emitted
      // them (per-part topo isn't shipped — chips are best-effort here).
      features: runFeatures(result),
      aestheticScore: result.aestheticScore ?? null,
      // An assembly counts as remeshed when the run was, or ANY part's
      // mesh came from the voxel fallback (docs/text-to-cad/02 §C).
      remeshed:
        (result.run?.remeshed ?? false) ||
        parts.some((p) => p.remeshed === true),
      // Isolation verdict rides the compound run (checks run on the whole
      // mesh before any assembly promotion).
      networksReport: result.run?.checks?.networks ?? null,
      // Dimension-contract verdicts (MTR-197). bbox/count/fit verdicts are
      // assembly-valid; feature-level face anchors ride the primary solid's
      // topology (per-part topo isn't shipped), same best-effort as features.
      dimensionChecks: runDimensionChecks(result),
      configFingerprint: harnessConfigFingerprint(result.route, opts.process),
      ...resultExtras(result),
      // Thread owns the title going forward; root-row title stays as the
      // legacy-read fallback.
      ...(isRoot ? { title } : {}),
      ...(threadId ? { threadId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(cadGenerations.id, generationId));

  return {
    generationId,
    fileAssetId: created[0].fileAssetId,
    fileSlug: created[0].fileSlug,
    renderUrl,
    // Primary part's STEP availability drives the top-level download affordance.
    hasStep: created[0].hasStep ?? false,
    sourceCode: result.sourceCode,
    title,
    parts: created.map((c) => ({
      name: c.name,
      fileAssetId: c.fileAssetId,
      fileSlug: c.fileSlug,
      hasStep: c.hasStep ?? false,
    })),
    projectSlug,
    remeshed: result.run?.remeshed ?? false,
    networksReport: result.run?.checks?.networks ?? null,
    features: runFeatures(result) ?? [],
    dimensionChecks: runDimensionChecks(result) ?? [],
  };
}
