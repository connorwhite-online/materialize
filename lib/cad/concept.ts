import "server-only";

import { fal } from "@fal-ai/client";
import type { PromptImage } from "./model-client";
import { logError } from "@/lib/logger";

/**
 * Per-prompt CONCEPT IMAGE for the build123d (functional) path: a quick, cheap
 * text-to-image render of a beautiful product concept, shown to the code
 * generator as an AESTHETIC TARGET. build123d supplies the function + precision;
 * the concept supplies the taste (form language, proportion, finish) that
 * hand-authored code exemplars can't. Gated by FAL_KEY (flux ~$0.003); fully
 * inert without it. Disable with CAD_CONCEPT_IMAGE=false.
 */

const FLUX_MODEL = process.env.FAL_TEXT_TO_IMAGE_MODEL || "fal-ai/flux/schnell";

export function conceptImageEnabled(): boolean {
  return !!process.env.FAL_KEY && process.env.CAD_CONCEPT_IMAGE !== "false";
}

/** Instruction paired with the concept image in the generate prompt. */
export const CONCEPT_IMAGE_NOTE =
  "A concept render of the TARGET aesthetic is attached. Match its overall form language, proportions, stance, and finish — soft unified radii, clean restrained surfacing, a cohesive single body. It is a STYLE GUIDE, not a literal spec: keep the part functional, watertight, and printable, and ignore any unprintable or purely decorative flourishes.";

/** Generate a concept render for the prompt, or null (disabled / any failure). */
export async function conceptImage(
  prompt: string,
  signal?: AbortSignal
): Promise<PromptImage | null> {
  if (!conceptImageEnabled()) return null;
  try {
    fal.config({ credentials: process.env.FAL_KEY });
    const res = await fal.subscribe(FLUX_MODEL, {
      input: {
        prompt:
          prompt +
          " -- the EMPTY product itself ALONE (no contents, no items inside, no extra objects, no people); industrial product design concept, a single clean minimalist object, refined proportions, soft unified fillets, premium matte finish, neutral studio lighting, plain seamless background, no text",
        image_size: "square_hd",
        num_inference_steps: 4,
        output_format: "png",
      },
      abortSignal: signal,
    });
    const url = (res.data as { images?: Array<{ url?: unknown }> })?.images?.[0]
      ?.url;
    if (typeof url !== "string") return null;
    const dl = await fetch(url, { signal });
    if (!dl.ok) return null;
    const data = Buffer.from(await dl.arrayBuffer()).toString("base64");
    return { data, mediaType: "image/png" };
  } catch (err) {
    logError("conceptImage", err);
    return null;
  }
}
