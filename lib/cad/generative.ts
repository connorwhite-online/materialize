import "server-only";

import { fal } from "@fal-ai/client";
import { completeText, type PromptImage } from "./model-client";
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
 * storage. Default model is Rodin (hyper3d), which does BOTH text and image and
 * was verified end-to-end; "Shaded"/medium quality keeps the mesh lean (~5 MB
 * vs ~14 MB textured). Gated entirely by FAL_KEY — with no key nothing here runs.
 */

const TEXT_MODEL = process.env.FAL_TEXT_TO_3D_MODEL || "fal-ai/hyper3d/rodin";
const IMAGE_MODEL = process.env.FAL_IMAGE_TO_3D_MODEL || "fal-ai/hyper3d/rodin";
/** Generated meshes have arbitrary scale; fit the longest axis to this (mm). */
const DEFAULT_PRINT_SIZE_MM = 60;

export function generativeEnabled(): boolean {
  return !!process.env.FAL_KEY;
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
  signal?: AbortSignal
): Promise<boolean> {
  if (!generativeEnabled()) return false;
  try {
    const verdict = await completeText({
      system:
        "You route a 3D-model request to the right engine. Reply with ONE word:\n" +
        "ORGANIC — an organic, sculptural, character, creature, figurine, anatomical, or freeform-artistic form best made by a generative 3D model.\n" +
        "MECHANICAL — a functional/parametric/geometric part (bracket, enclosure, gear, mount, clip, container, tool, fixture, lattice/infill). When in doubt, MECHANICAL.\n" +
        "Reply with only the single word.",
      prompt,
      model: modelForRole("plan"),
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
  const note = `# Generated with fal.ai (${hasImage ? IMAGE_MODEL : TEXT_MODEL})\n# Prompt: ${opts.prompt}\n# Organic/sculptural form — generative mesh, not parametric build123d.`;

  try {
    fal.config({ credentials: process.env.FAL_KEY });
    emit({ type: "phase", phase: "generating", attempt: 1, maxAttempts: 1 });

    // Lean output (no PBR textures, medium poly) — we only need geometry, and
    // it keeps the mesh small enough to hand to the sidecar inline.
    const common = {
      material: "Shaded",
      quality: "medium",
      geometry_file_format: "glb",
    };
    let input: Record<string, unknown>;
    let model: string;
    if (hasImage) {
      const img = opts.images![0];
      const blob = new Blob([Buffer.from(img.data, "base64")], {
        type: img.mediaType,
      });
      const imageUrl = await fal.storage.upload(blob);
      model = IMAGE_MODEL;
      input = { input_image_urls: [imageUrl], ...common };
    } else {
      model = TEXT_MODEL;
      input = { prompt: opts.prompt, ...common };
    }

    const res = await fal.subscribe(model, {
      input,
      abortSignal: opts.signal,
    });
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
    const run = await runCadCode(code, ["stl"], opts.signal);

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
