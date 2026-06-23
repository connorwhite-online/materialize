import "server-only";

import { completeText, type PromptImage } from "./model-client";
import { modelForRole } from "./models";
import { runCadCode } from "./runner-client";
import type { HarnessResult } from "./harness";
import type { CadProgressEvent } from "./types";
import { logError } from "@/lib/logger";

/**
 * Generative-mesh backend (fal.ai). For ORGANIC / sculptural / character forms
 * that a B-rep kernel (build123d) fundamentally cannot make, we call a
 * text/image-to-3D model, download the resulting GLB, and run it through the
 * SAME sidecar mesh pipeline (trimesh repair -> watertight -> render) the
 * lattice/mesh-mode path uses. Output is a printable STL like any other
 * generation (no editable STEP — generative meshes aren't parametric).
 *
 * fal is an aggregator: one key fronts Trellis / Hunyuan3D / Tripo, so the
 * model ids are env-overridable for A/B. Gated entirely by FAL_KEY: with no
 * key, generativeEnabled() is false and nothing here runs.
 */

/** Text-to-3D when there's no reference image; image-to-3D when there is. */
const TEXT_MODEL =
  process.env.FAL_TEXT_TO_3D_MODEL || "fal-ai/tripo3d/tripo/v2.5/text-to-3d";
const IMAGE_MODEL = process.env.FAL_IMAGE_TO_3D_MODEL || "fal-ai/trellis";
const FAL_POLL_MS = 2500;
const FAL_TIMEOUT_MS = 240_000;
/** Generated meshes have arbitrary scale; fit the longest axis to this (mm). */
const DEFAULT_PRINT_SIZE_MM = 60;

export function generativeEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Submit to fal's queue and poll to completion; returns the result payload. */
async function falRun(
  model: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY not set");
  const auth = { Authorization: `Key ${key}` };

  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!submit.ok) {
    throw new Error(`fal submit ${submit.status}: ${await submit.text()}`);
  }
  const { status_url, response_url } = (await submit.json()) as {
    status_url: string;
    response_url: string;
  };

  const deadline = Date.now() + FAL_TIMEOUT_MS;
  for (;;) {
    if (signal?.aborted) throw new Error("aborted");
    if (Date.now() > deadline) throw new Error("fal generation timed out");
    await sleep(FAL_POLL_MS);
    const s = await fetch(status_url, { headers: auth, signal });
    if (!s.ok) continue;
    const sj = (await s.json()) as { status?: string };
    if (sj.status === "COMPLETED") break;
    if (sj.status === "FAILED" || sj.status === "ERROR") {
      throw new Error(`fal generation failed: ${JSON.stringify(sj)}`);
    }
  }

  const res = await fetch(response_url, { headers: auth, signal });
  if (!res.ok) throw new Error(`fal result ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Pull the mesh URL out of the various shapes fal models return. */
function meshUrlOf(payload: Record<string, unknown>): string | null {
  const out = (payload.output as Record<string, unknown>) ?? payload;
  const candidates = [out.model_mesh, out.model_glb, out.mesh, out.glb];
  for (const c of candidates) {
    if (typeof c === "string") return c;
    if (c && typeof c === "object" && typeof (c as { url?: string }).url === "string") {
      return (c as { url: string }).url;
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
 * Run the generative backend end-to-end: fal -> GLB -> sidecar mesh pipeline.
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
  const note = `# Generated with fal.ai (${opts.images?.length ? IMAGE_MODEL : TEXT_MODEL})\n# Prompt: ${opts.prompt}\n# Organic/sculptural form — generative mesh, not parametric build123d.`;

  try {
    emit({ type: "phase", phase: "generating", attempt: 1, maxAttempts: 1 });
    const img = opts.images?.[0];
    const payload = img
      ? await falRun(
          IMAGE_MODEL,
          { image_url: `data:${img.mediaType};base64,${img.data}` },
          opts.signal
        )
      : await falRun(TEXT_MODEL, { prompt: opts.prompt }, opts.signal);

    const url = meshUrlOf(payload);
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
      "_ext = _m.extents",
      "_longest = float(max(_ext)) or 1.0",
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
