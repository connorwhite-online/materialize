import { auth, currentUser } from "@clerk/nextjs/server";

import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { buildBrief } from "@/lib/cad/brief";
import type { PromptImage } from "@/lib/cad/model-client";

/**
 * Draft-a-brief endpoint for the text-to-CAD studio (docs/text-to-cad/06):
 * one model completion that turns the composer's prompt (+ reference images)
 * into a structured design brief the user can review and edit BEFORE
 * generating. The edited brief is then sent back with POST /api/cad/generate,
 * which replaces the harness's own brief step with it.
 *
 * Best-effort by contract, mirroring `buildBrief`: when the step can't
 * produce a brief (no model credentials, bad JSON, schema mismatch) this
 * returns 200 `{ brief: null }` — the client treats that as "brief
 * unavailable, generate directly", never as a failure.
 *
 * Auth + gating mirror /api/cad/generate exactly, including hiding the
 * feature's existence behind a 404.
 */

export const dynamic = "force-dynamic";
// One model round-trip; comfortably below the generate route's ceiling.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    // Mirror the page's notFound() — don't reveal the feature exists.
    return new Response("Not found", { status: 404 });
  }

  let body: {
    prompt?: string;
    images?: PromptImage[];
  };
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

  // Sanitize reference images: allowed types only, capped count — the same
  // rules as /api/cad/generate so a brief sees what the build will see.
  const ALLOWED_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ];
  const images: PromptImage[] = (body.images ?? [])
    .filter(
      (i) =>
        i &&
        typeof i.data === "string" &&
        ALLOWED_IMAGE_TYPES.includes(i.mediaType)
    )
    .slice(0, 4);

  const brief = await buildBrief({
    prompt,
    images: images.length ? images : undefined,
    signal: request.signal,
  });

  return Response.json({ brief });
}
