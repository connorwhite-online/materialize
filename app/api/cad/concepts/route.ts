import { auth, currentUser } from "@clerk/nextjs/server";

import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { conceptImage, conceptImageEnabled } from "@/lib/cad/concept";
import { proposeConceptDirections } from "@/lib/cad/concept-directions";
import type { PromptImage } from "@/lib/cad/model-client";

/**
 * Pre-build concept picker endpoint (the composer-side diverge step): the
 * in-job picker's question card auto-resolves after its timeout because the
 * whole job lives inside a serverless wall clock — fine for walking away,
 * tight for choosing a design direction. This endpoint moves the choice
 * BEFORE the build: the composer requests directions + one render each, the
 * user picks with NO time pressure, and POST /api/cad/generate carries the
 * chosen render as `concept.png` — the harness then uses it verbatim (its
 * own concept generation and in-job picker are skipped).
 *
 * Directions are proposed per-prompt (lib/cad/concept-directions.ts —
 * broad, spanning THIS object's design space; fixed presets only as the
 * fallback). Renders are reference-conditioned when the composer sends its
 * attached images.
 *
 * Best-effort: `{ concepts: [] }` whenever renders can't be produced (no
 * FAL key, all generations failed) — the client hides the affordance's
 * results and the build proceeds exactly as before.
 *
 * Auth + gating mirror /api/cad/generate, including hiding the feature's
 * existence behind a 404.
 */

export const dynamic = "force-dynamic";
// Direction proposal + three image generations in parallel.
export const maxDuration = 90;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    return new Response("Not found", { status: 404 });
  }

  let body: { prompt?: string; images?: PromptImage[] };
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  if (prompt.length < 3) {
    return new Response("Describe what you want to make.", { status: 400 });
  }
  if (prompt.length > 2000) {
    return new Response("Prompt is too long.", { status: 400 });
  }
  if (!conceptImageEnabled()) {
    return Response.json({ concepts: [] });
  }

  // Sanitize reference images: same rules as /api/cad/generate.
  const ALLOWED_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ];
  const MAX_IMAGE_B64_CHARS = 6_500_000;
  const images: PromptImage[] = (body.images ?? [])
    .filter(
      (i) =>
        i &&
        typeof i.data === "string" &&
        i.data.length <= MAX_IMAGE_B64_CHARS &&
        ALLOWED_IMAGE_TYPES.includes(i.mediaType)
    )
    .slice(0, 4);

  const directions = await proposeConceptDirections({
    prompt,
    phase: "explore",
    signal: request.signal,
  });

  const concepts = (
    await Promise.all(
      directions.map(async (d, i) => {
        const img = await conceptImage(
          prompt,
          request.signal,
          `style direction: ${d.label} — ${d.detail}`,
          images.length > 0 ? images : undefined
        );
        return img
          ? { id: `concept-${i + 1}`, label: d.label, detail: d.detail, png: img.data }
          : null;
      })
    )
  ).filter((c): c is NonNullable<typeof c> => c !== null);

  return Response.json({ concepts });
}
