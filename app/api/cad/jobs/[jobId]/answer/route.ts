import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations, cadJobs } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { encodeCustomAnswer } from "@/lib/cad/types";

/**
 * Answer a mid-cycle interactive question on a background CAD job (MTR-191).
 *
 * Records the user's answer for a `question` progress event into
 * cadJobs.answers (questionId -> chosen optionId, OR a free-text answer from
 * the always-present custom field, MTR-209). The executor's awaiting_input poll notices
 * it, appends the resolving `answer` event, and flips the job back to
 * `running` — the SAME single-writer model as POST .../cancel: this endpoint
 * is the only answer-writer, the executor the only reader/status-transitioner.
 * Idempotent by last-write-wins merge; re-posting the same pick is a 200 no-op.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max length of a free-text custom answer (matches the composer cap). */
const MAX_TEXT_LEN = 2000;
/** Max length of a preset option id. */
const MAX_OPTION_LEN = 200;

/**
 * Validate + normalize an answer body. The client sends EITHER a preset
 * `optionId` (a card pick) OR a free-text `text` (the always-present custom
 * field, MTR-209). Both land in `cadJobs.answers[questionId]` — the same column
 * the executor already reads — but a free-text answer is sentinel-encoded
 * (MTR-216) so the executor can tell an intentional typed answer from a preset
 * option id and honor it downstream instead of discarding it as non-matching.
 * Pure + exported so the branch table is unit-tested without the route's
 * auth/DB shell.
 */
export function parseAnswerBody(
  body: unknown
): { questionId: string; answer: string } | null {
  const questionId = (body as { questionId?: unknown })?.questionId;
  if (typeof questionId !== "string" || !questionId || questionId.length > 200) {
    return null;
  }
  const optionId = (body as { optionId?: unknown })?.optionId;
  const text = (body as { text?: unknown })?.text;

  // Preset pick takes precedence when present and valid — stored bare so it
  // matches an offered option id.
  if (typeof optionId === "string" && optionId && optionId.length <= MAX_OPTION_LEN) {
    return { questionId, answer: optionId };
  }
  // Otherwise accept a non-empty, length-bounded free-text answer, encoded with
  // the custom-answer sentinel so the executor honors it as a typed constraint.
  if (typeof text === "string") {
    const trimmed = text.trim();
    if (trimmed && trimmed.length <= MAX_TEXT_LEN) {
      return { questionId, answer: encodeCustomAnswer(trimmed) };
    }
  }
  return null;
}

export async function POST(
  request: Request,
  props: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await props.params;

  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    // Mirror the page's notFound() — don't reveal the feature exists.
    return new Response("Not found", { status: 404 });
  }

  // Reject non-UUIDs before they hit Postgres as a cast error.
  if (!UUID_RE.test(jobId)) return new Response("Not found", { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const parsed = parseAnswerBody(body);
  if (!parsed) {
    return new Response("Bad request", { status: 400 });
  }
  const { questionId, answer } = parsed;

  // Ownership: the job belongs to whoever owns its generation. Load the current
  // answers so we can merge (the executor never writes this column, so there's
  // no concurrent-writer race — this endpoint is the sole answer-writer).
  const [job] = await db
    .select({
      id: cadJobs.id,
      status: cadJobs.status,
      answers: cadJobs.answers,
      ownerId: cadGenerations.userId,
    })
    .from(cadJobs)
    .innerJoin(cadGenerations, eq(cadJobs.generationId, cadGenerations.id))
    .where(eq(cadJobs.id, jobId))
    .limit(1);
  if (!job || job.ownerId !== userId) {
    return new Response("Not found", { status: 404 });
  }

  // Terminal jobs can't be answered — nothing is polling. Not an error: the
  // question resolved (default taken) before the answer arrived; ack as no-op.
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
    return Response.json({ ok: true, applied: false });
  }

  await db
    .update(cadJobs)
    .set({
      answers: { ...(job.answers ?? {}), [questionId]: answer },
      updatedAt: new Date(),
    })
    .where(eq(cadJobs.id, jobId));

  return Response.json({ ok: true, applied: true });
}
