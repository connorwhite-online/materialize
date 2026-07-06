import { after } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import type { PriorFeedback } from "@/lib/cad/harness";
import { createCadJob, executeCadJob } from "@/lib/cad/jobs";
import type { PromptImage } from "@/lib/cad/model-client";
import { PROCESS_DFM, type CadProcess } from "@/lib/cad/knowledge/dfm";
import { checkCadGenerateRateLimit } from "./rate-limit";

/**
 * Target-process threading (MTR-171). The harness already branches DFM
 * guidance on `HarnessInput.process` (process-specific envelope vs the
 * conservative multi-process one) — the seam just never received a value.
 * These two pure helpers turn the request (+ a revision's parent) into that
 * value, and are exported for unit testing.
 */

/**
 * A request value is a real process only if it is one of PROCESS_DFM's OWN
 * keys. Uses hasOwnProperty, not `in` — the latter walks the prototype chain,
 * so `"toString"`/`"constructor"` would otherwise pass and then index onto a
 * function instead of a ProcessDfm.
 */
export function parseTargetProcess(value: unknown): CadProcess | null {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PROCESS_DFM, value)
    ? (value as CadProcess)
    : null;
}

/**
 * Resolve the process a generation should build for: an explicit, valid pick
 * wins; otherwise a revision inherits the process stamped on its parent's
 * config fingerprint. Fresh builds with no pick stay unset (null) → the
 * conservative envelope, exactly as before.
 */
export function resolveGenerationProcess(
  requested: unknown,
  parentFingerprint: unknown
): CadProcess | null {
  const explicit = parseTargetProcess(requested);
  if (explicit) return explicit;
  const fp = parentFingerprint as { process?: unknown } | null | undefined;
  return fp ? parseTargetProcess(fp.process) : null;
}

/**
 * Generate endpoint for the text-to-CAD studio (MTR-175: background jobs).
 *
 * Validates + gates, inserts the pending cadGenerations row and a queued
 * cadJobs row, schedules executeCadJob in the background via after(), and
 * returns { generationId, jobId } immediately (202). The studio then tails
 * GET /api/cad/jobs/[jobId]/events for progress — the job row is the source
 * of truth, so the client can disconnect and reattach freely, and closing
 * the tab no longer kills the build (cancellation is the explicit
 * POST /api/cad/jobs/[jobId]/cancel).
 */

export const dynamic = "force-dynamic";
// The background job (multiple model round-trips plus a sidecar call per
// repair attempt) runs via after(), and on Vercel after() callbacks execute
// within THIS function's lifetime — so maxDuration still bounds the total
// effort a job can spend. Prod must run on a plan that allows this (and
// host the sidecar). The unbounded upgrade path is moving executeCadJob to
// the Railway worker (docs/text-to-cad/02 §B option 2) — the job/events/
// cancel contract doesn't change.
export const maxDuration = 300;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    // Mirror the page's notFound() — don't reveal the feature exists.
    return new Response("Not found", { status: 404 });
  }

  // Per-user frequency backstop (MTR-169): reject a runaway/retry loop before
  // it can chain another round of model + fal.ai spend. Generous window so it
  // never fires on legitimate iterative revise/repair use.
  const rate = await checkCadGenerateRateLimit(userId);
  if (!rate.ok) {
    return new Response(
      `You've started ${rate.count} generations in the last ` +
        `${rate.windowMinutes} minutes. Give it a moment and try again.`,
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      }
    );
  }

  let body: {
    prompt?: string;
    parentGenerationId?: string;
    name?: string;
    images?: PromptImage[];
    /** User-reviewed design brief from the studio's brief card. */
    brief?: unknown;
    /**
     * Optional target CraftCloud process (MTR-171). When one of PROCESS_DFM's
     * keys, the harness injects that process's DFM envelope instead of the
     * conservative multi-process one; anything else (incl. "any"/omitted) keeps
     * today's behavior. Revisions inherit the parent's process when unset.
     */
    process?: unknown;
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

  // Sanitize reference images: allowed types only, capped count.
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

  // When revising, load the parent's source to seed the harness — and verify
  // it belongs to the caller. This stays HERE, pre-job, so an unauthorized
  // request fails before a generation or job row ever exists.
  let priorSourceCode: string | null = null;
  let priorFeedback: PriorFeedback | null = null;
  let priorBrief: unknown;
  let parentFingerprint: unknown = null;
  if (body.parentGenerationId) {
    const [parent] = await db
      .select({
        sourceCode: cadGenerations.sourceCode,
        userId: cadGenerations.userId,
        rating: cadGenerations.rating,
        feedbackTags: cadGenerations.feedbackTags,
        feedbackNote: cadGenerations.feedbackNote,
        brief: cadGenerations.brief,
        configFingerprint: cadGenerations.configFingerprint,
      })
      .from(cadGenerations)
      .where(eq(cadGenerations.id, body.parentGenerationId))
      .limit(1);
    if (!parent || parent.userId !== userId) {
      return new Response("Original model not found.", { status: 404 });
    }
    priorSourceCode = parent.sourceCode;
    // Carry the parent's feedback into the revision so the model corrects it.
    priorFeedback = {
      rating: parent.rating,
      tags: parent.feedbackTags,
      note: parent.feedbackNote,
    };
    // Revisions inherit the parent's design brief (docs/text-to-cad/06).
    priorBrief = parent.brief ?? undefined;
    // …and the parent's target process (MTR-171), unless this request overrides.
    parentFingerprint = parent.configFingerprint ?? null;
  }

  // Target process for DFM guidance (MTR-171): an explicit valid pick wins;
  // otherwise a revision inherits its parent's process; else unset → the
  // conservative envelope (unchanged behavior for existing flows).
  const process = resolveGenerationProcess(body.process, parentFingerprint);

  const [row] = await db
    .insert(cadGenerations)
    .values({
      userId,
      prompt,
      engine: "build123d",
      parentGenerationId: body.parentGenerationId ?? null,
      status: "pending",
    })
    .returning({ id: cadGenerations.id });
  const generationId = row.id;

  const { jobId } = await createCadJob(generationId);

  // Kick the job after the response is sent. Deliberately NOT tied to
  // request.signal: a client disconnect must not abort the build anymore.
  after(() =>
    executeCadJob({
      jobId,
      generationId,
      userId,
      prompt,
      parentGenerationId: body.parentGenerationId ?? null,
      name: body.name,
      images: images.length ? images : undefined,
      process,
      priorSourceCode,
      priorFeedback,
      priorBrief,
      // Size-capped: the harness zod-validates; this only blocks abuse.
      providedBrief:
        body.brief != null && JSON.stringify(body.brief).length <= 20_000
          ? body.brief
          : undefined,
    }).catch((error) => logError("api/cad/generate.job", error))
  );

  return Response.json({ generationId, jobId }, { status: 202 });
}
