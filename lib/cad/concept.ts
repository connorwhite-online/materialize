import "server-only";

import { fal } from "@fal-ai/client";
import { meterFalCall } from "./metering";
import type { PromptImage } from "./model-client";
import { logError } from "@/lib/logger";

/**
 * Per-prompt CONCEPT IMAGE for the build123d (functional) path: a quick, cheap
 * render of a beautiful product concept, shown to the code generator as an
 * AESTHETIC TARGET. build123d supplies the function + precision; the concept
 * supplies the taste (form language, proportion, finish) that hand-authored
 * code exemplars can't. Gated by FAL_KEY; fully inert without it. Disable
 * with CAD_CONCEPT_IMAGE=false.
 *
 * Two modes:
 *   - No user references: text-to-image (flux ~$0.003) from the prompt+brief.
 *   - User references attached: image-to-image CONDITIONED ON the first
 *     reference — the concept is a cleaned-up product-render interpretation
 *     of what the user showed us, never an unrelated invention that would
 *     compete with it. On any failure here we return null rather than fall
 *     back to text-only: a concept that ignores the references is worse
 *     than no concept.
 *
 * Both prompts are grounded in what the CAD engines can actually express —
 * a concept the B-rep/SDF kernels can't approach is a moonshot render, not
 * a target.
 */

const FLUX_MODEL = process.env.FAL_TEXT_TO_IMAGE_MODEL || "fal-ai/flux/schnell";
// Instruction-following image edit model for the reference-conditioned path.
const IMAGE_TO_IMAGE_MODEL =
  process.env.FAL_IMAGE_TO_IMAGE_MODEL || "fal-ai/flux-pro/kontext";

export function conceptImageEnabled(): boolean {
  return !!process.env.FAL_KEY && process.env.CAD_CONCEPT_IMAGE !== "false";
}

/** Instruction paired with a text-derived concept in the generate prompt. */
export const CONCEPT_IMAGE_NOTE =
  "The image captioned \"AI-generated concept render\" shows the TARGET aesthetic. Match its overall form language, proportions, stance, and finish — soft unified radii, clean restrained surfacing, a cohesive single body. It is a STYLE GUIDE, not a literal spec: keep the part functional, watertight, and printable, and ignore any unprintable or purely decorative flourishes."

/**
 * Instruction paired with a reference-derived concept: it interprets the
 * user's references, and the references stay authoritative.
 */
export const CONCEPT_FROM_REFS_NOTE =
  "The concept render is DERIVED FROM the user's reference images — a cleaned-up product-design interpretation of what they showed. Build toward it, but the user's own references win on any conflict.";

/** Caption block sent immediately before a text-derived concept image. */
export const CONCEPT_IMAGE_LABEL =
  "AI-generated concept render — a machine-imagined style guide for this build, NOT something the user provided.";

/** Caption block for a reference-derived concept image. */
export const CONCEPT_FROM_REFS_LABEL =
  "AI-generated concept render DERIVED FROM the user's reference images — a cleaned-up interpretation, NOT something the user provided.";

/** Judge-side caption: the target this build aimed for. */
export const CONCEPT_JUDGE_LABEL =
  "Concept render this build aimed toward — the aesthetic target.";

/** Caption for a concept the user explicitly chose (picker / composer). */
export const CONCEPT_CHOSEN_LABEL =
  "Concept render the user CHOSE as this build's aesthetic target.";

/**
 * Caption a chosen concept carries as a PERSISTED thread reference
 * (lib/cad/reference-images.ts) — matched exactly to find the thread's
 * current target on later turns, so keep it byte-stable.
 */
export const CONCEPT_THREAD_REF_LABEL =
  "Concept render this thread is building toward — the chosen aesthetic target, NOT something the user provided.";

// Shared style suffix. The CAD-expressibility clause is load-bearing: the
// concept is a build target, so it must stay inside what the B-rep/SDF
// engines can realize (solids, shells, uniform fillets) — no fabric, no
// filigree, no floating parts the generator could never model.
const CONCEPT_STYLE =
  " -- the EMPTY product itself ALONE (no contents, no items inside, no extra objects, no people); industrial product design concept, a single clean minimalist object, refined proportions, soft unified fillets, premium matte finish, neutral studio lighting, plain seamless background, no text; solid manufacturable geometry a parametric CAD program can express (clean solids, shells, uniform fillets) — no floating parts, no fabric, no filigree";

function firstImageUrl(data: unknown): string | null {
  const images = (data as { images?: Array<{ url?: unknown }> })?.images;
  const url = images?.[0]?.url;
  return typeof url === "string" ? url : null;
}

/**
 * Generate a concept render for the prompt, or null (disabled / any failure).
 * `briefDescription` (from formatBriefForConcept) folds the design brief's
 * form language + envelope into the prompt so the taste target matches the
 * functional reality (docs/text-to-cad/06 part 1). `refs` switches to the
 * reference-conditioned mode above (first reference conditions the render —
 * the edit models take one image).
 */
export async function conceptImage(
  prompt: string,
  signal?: AbortSignal,
  briefDescription?: string | null,
  refs?: PromptImage[] | null
): Promise<PromptImage | null> {
  if (!conceptImageEnabled()) return null;
  const derived = !!refs?.length;
  try {
    fal.config({ credentials: process.env.FAL_KEY });
    const started = Date.now();
    let model: string;
    let input: Record<string, unknown>;
    if (derived) {
      const ref = refs![0];
      const refUrl = await fal.storage.upload(
        new Blob([Buffer.from(ref.data, "base64")], { type: ref.mediaType })
      );
      model = IMAGE_TO_IMAGE_MODEL;
      input = {
        prompt:
          `Re-render the object in this image as a clean industrial product-design concept. Keep ITS form language, proportions, and distinctive features — do not invent a different object. Requested part: ${prompt}` +
          (briefDescription ? ` -- ${briefDescription}` : "") +
          CONCEPT_STYLE,
        image_url: refUrl,
        output_format: "png",
      };
    } else {
      model = FLUX_MODEL;
      input = {
        prompt:
          prompt +
          (briefDescription ? ` -- ${briefDescription}` : "") +
          CONCEPT_STYLE,
        image_size: "square_hd",
        num_inference_steps: 4,
        output_format: "png",
      };
    }
    const res = await fal.subscribe(model, { input, abortSignal: signal });
    // Cost metering (MTR-181): raw fal invocations, priced later.
    meterFalCall(model, Date.now() - started);
    const url = firstImageUrl(res.data);
    if (!url) return null;
    const dl = await fetch(url, { signal });
    if (!dl.ok) return null;
    const data = Buffer.from(await dl.arrayBuffer()).toString("base64");
    return {
      data,
      mediaType: "image/png",
      label: derived ? CONCEPT_FROM_REFS_LABEL : CONCEPT_IMAGE_LABEL,
    };
  } catch (err) {
    logError("conceptImage", err);
    return null;
  }
}
