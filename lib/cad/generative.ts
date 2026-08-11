import "server-only";

import { fal } from "@fal-ai/client";
import { completeText, type PromptImage } from "./model-client";
import { labelUserReferences } from "./types";
import { meterFalCall } from "./metering";
import { modelForRole } from "./models";
import { runCadCode } from "./runner-client";
import type { HarnessResult } from "./harness";
import type { CadProgressEvent } from "./types";
import { logError } from "@/lib/logger";

/**
 * Generative-mesh backend (fal.ai). For ORGANIC / sculptural / character forms
 * that a B-rep kernel (build123d) fundamentally cannot make, we call a
 * text/image-to-3D model, download the resulting mesh, and run it through the
 * SAME sidecar mesh pipeline (trimesh repair -> watertight -> render) the
 * lattice/mesh-mode path uses. Output is a printable STL like any other
 * generation (no editable STEP — generative meshes aren't parametric).
 *
 * Uses the @fal-ai/client SDK, not raw REST: fal's queue result endpoint 404s
 * for nested model ids (verified), and the SDK also handles image upload to fal
 * storage.
 *
 * COST/QUALITY: the default is Hunyuan3D-2 white-mesh image-to-3D ($0.16, good
 * geometry) — for a text prompt we first do a quick text-to-image (flux schnell,
 * ~$0.003), so ~$0.16/generation. (Trellis is cheaper at $0.02 but reconstructed
 * flat slabs from generated images — not usable. Rodin/hyper3d is higher quality
 * but ~$0.40-2/gen; opt in via FAL_TEXT_TO_3D_MODEL=fal-ai/hyper3d/rodin, which
 * switches the text path to that model directly.)
 *
 * Gated entirely by FAL_KEY — with no key nothing here runs.
 */

const IMAGE_MODEL = process.env.FAL_IMAGE_TO_3D_MODEL || "fal-ai/hunyuan3d/v2";
const TEXT_TO_IMAGE_MODEL =
  process.env.FAL_TEXT_TO_IMAGE_MODEL || "fal-ai/flux/schnell";
// Opt-in: a direct text-to-3D model (e.g. fal-ai/hyper3d/rodin). When unset,
// text prompts go through the cheap text-to-image -> image-to-3D pipeline.
const DIRECT_TEXT_TO_3D = process.env.FAL_TEXT_TO_3D_MODEL || null;
/** Generated meshes have arbitrary scale; fit the longest axis to this (mm). */
const DEFAULT_PRINT_SIZE_MM = 60;

export function generativeEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

/** Pull the first image URL out of a text-to-image response (flux et al.). */
function res2Images(data: Record<string, unknown> | undefined): string | null {
  const images = data?.images;
  if (Array.isArray(images) && images[0]) {
    const u = (images[0] as { url?: unknown }).url;
    if (typeof u === "string") return u;
  }
  return null;
}

/** Pull the mesh URL out of the shapes fal models return. */
function meshUrlOf(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const candidates = [data.model_mesh, data.model_glb, data.mesh, data.glb];
  for (const c of candidates) {
    if (typeof c === "string") return c;
    if (c && typeof c === "object") {
      const url = (c as { url?: unknown }).url;
      if (typeof url === "string") return url;
    }
  }
  return null;
}

/**
 * Classify whether a prompt is best served by the generative backend. Cheap
 * model call; fail-safe to false so any hiccup just uses the build123d path.
 */
export async function shouldUseGenerative(
  prompt: string,
  signal?: AbortSignal,
  images?: PromptImage[] | null
): Promise<boolean> {
  if (!generativeEnabled()) return false;
  try {
    const refs = labelUserReferences(images);
    const verdict = await completeText({
      system:
        "You route a 3D-model request to the right engine. Reply with ONE word:\n" +
        "ORGANIC — a NON-functional sculptural / character / creature / figurine / decorative / anatomical form with no precise functional features (best made by a generative 3D model).\n" +
        "MECHANICAL — ANY functional/parametric part, INCLUDING ones meant to look organic, sculptural, topology-optimized, or lightweighted (bracket, mount, handle, holder, enclosure, clip, gear, tool, fixture, lattice). These are built with the CAD/SDF toolkit, which can do organic functional form. When in doubt, MECHANICAL.\n" +
        "Reference images may be attached — classify the requested object from BOTH the text and the images (a terse prompt with a detailed photo is whatever the photo shows).\n" +
        "Reply with only the single word.",
      prompt,
      model: modelForRole("plan"),
      role: "route",
      images: refs.length ? refs : undefined,
      signal,
    });
    return /\bORGANIC\b/i.test(verdict);
  } catch (err) {
    logError("shouldUseGenerative", err);
    return false;
  }
}

/**
 * Run the generative backend end-to-end: fal -> mesh -> sidecar mesh pipeline.
 * Returns a HarnessResult so the route persists it exactly like a code result.
 */
export async function runGenerative(opts: {
  prompt: string;
  images?: PromptImage[] | null;
  signal?: AbortSignal;
  onProgress?: (e: CadProgressEvent) => void;
}): Promise<HarnessResult> {
  const emit = (e: CadProgressEvent) => {
    try {
      opts.onProgress?.(e);
    } catch {
      /* progress is cosmetic */
    }
  };
  const hasImage = !!opts.images?.length;
  const pathLabel = hasImage
    ? IMAGE_MODEL
    : DIRECT_TEXT_TO_3D || `${TEXT_TO_IMAGE_MODEL} -> ${IMAGE_MODEL}`;
  const note = `# Generated with fal.ai (${pathLabel})\n# Prompt: ${opts.prompt}\n# Organic/sculptural form — generative mesh, not parametric build123d.`;

  try {
    fal.config({ credentials: process.env.FAL_KEY });
    emit({ type: "phase", phase: "generating", attempt: 1, maxAttempts: 1 });

    // Resolve a reference image, then image-to-3D — the cheap path. An attached
    // image is used directly; a text prompt gets a quick text-to-image first
    // (unless a premium direct text-to-3D model is configured).
    let imageUrl: string | null = null;
    if (hasImage) {
      // Image-to-3D takes ONE conditioning image; the first (newest) ref
      // wins. Multi-view conditioning needs a different fal model — if that
      // lands, thread the rest of opts.images here.
      const img = opts.images![0];
      const blob = new Blob([Buffer.from(img.data, "base64")], {
        type: img.mediaType,
      });
      imageUrl = await fal.storage.upload(blob);
    } else if (!DIRECT_TEXT_TO_3D) {
      const t2iStarted = Date.now();
      const t2i = await fal.subscribe(TEXT_TO_IMAGE_MODEL, {
        input: {
          prompt: `${opts.prompt}, the EMPTY product itself ALONE — no contents, no items inside it, no extra objects, no people; a single 3D object, centered, full body, plain neutral background, soft studio lighting, product render`,
          image_size: "square_hd",
          num_inference_steps: 4,
        },
        abortSignal: opts.signal,
      });
      // Cost metering (MTR-181): raw fal invocations, priced later.
      meterFalCall(TEXT_TO_IMAGE_MODEL, Date.now() - t2iStarted);
      const data = res2Images(t2i.data as Record<string, unknown>);
      if (!data) throw new Error("text-to-image returned no image");
      imageUrl = data;
    }

    const to3dModel = imageUrl ? IMAGE_MODEL : (DIRECT_TEXT_TO_3D as string);
    const to3dStarted = Date.now();
    const res = await fal.subscribe(
      to3dModel,
      {
        // Hunyuan3D-2 input shape (white mesh = geometry only, cheaper/smaller).
        // A different FAL_IMAGE_TO_3D_MODEL may need different param names.
        input: imageUrl
          ? { input_image_url: imageUrl, textured_mesh: false }
          : { prompt: opts.prompt },
        abortSignal: opts.signal,
      }
    );
    meterFalCall(to3dModel, Date.now() - to3dStarted);
    const url = meshUrlOf(res.data as Record<string, unknown>);
    if (!url) throw new Error("fal returned no mesh url");

    const dl = await fetch(url, { signal: opts.signal });
    if (!dl.ok) throw new Error(`mesh download ${dl.status}`);
    const b64 = Buffer.from(await dl.arrayBuffer()).toString("base64");
    const cleanUrl = url.split("?")[0].toLowerCase();
    const fileType = cleanUrl.endsWith(".obj")
      ? "obj"
      : cleanUrl.endsWith(".stl")
        ? "stl"
        : "glb";

    // Hand the mesh to the sidecar's mesh pipeline (repair -> watertight ->
    // render), scaled to a sensible print size. is_mesh branch handles it.
    emit({ type: "phase", phase: "executing", attempt: 1, maxAttempts: 1 });
    const code = [
      "import trimesh, io, base64",
      `_d = base64.b64decode("${b64}")`,
      `_m = trimesh.load(io.BytesIO(_d), file_type="${fileType}", force="mesh")`,
      "_longest = float(max(_m.extents)) or 1.0",
      `_m.apply_scale(${DEFAULT_PRINT_SIZE_MM}.0 / _longest)`,
      "result = _m",
    ].join("\n");
    // Generative meshes are frequently non-watertight as downloaded and the
    // model can't repair them (there's no code to fix) — the voxel remesh is
    // the intended rescue here, so opt in explicitly (docs/text-to-cad/02 §C).
    const run = await runCadCode(code, ["stl"], opts.signal, {
      allowRemesh: true,
    });

    emit({
      type: "validation",
      attempt: 1,
      maxAttempts: 1,
      pass: run.ok,
      failures: run.ok ? [] : ["generative mesh was not printable"],
      validation: run.validation,
    });

    return {
      ok: run.ok && !!run.files.stl,
      sourceCode: note,
      attempts: 1,
      run,
      error: run.ok ? undefined : run.error || "generative mesh failed",
    };
  } catch (err) {
    logError("runGenerative", err);
    return {
      ok: false,
      sourceCode: note,
      attempts: 1,
      error:
        (err as Error)?.name === "AbortError"
          ? "aborted"
          : `generative backend failed: ${(err as Error)?.message ?? err}`,
    };
  }
}
