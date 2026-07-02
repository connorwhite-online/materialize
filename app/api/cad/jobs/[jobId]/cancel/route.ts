import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations, cadJobs } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";

/**
 * Request cancellation of a background CAD generation job (MTR-175).
 *
 * Sets cancelRequestedAt (first request wins — idempotent, repeat calls
 * are 200 no-ops); executeCadJob's ~3s poll notices and aborts the
 * in-flight harness/sidecar work, flipping the job to `cancelled`.
 * Cancellation is cooperative and EXPLICIT — closing the tab or dropping
 * the events stream never cancels a job.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
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

  // Ownership: the job belongs to whoever owns its generation.
  const [job] = await db
    .select({ id: cadJobs.id, ownerId: cadGenerations.userId })
    .from(cadJobs)
    .innerJoin(cadGenerations, eq(cadJobs.generationId, cadGenerations.id))
    .where(eq(cadJobs.id, jobId))
    .limit(1);
  if (!job || job.ownerId !== userId) {
    return new Response("Not found", { status: 404 });
  }

  await db
    .update(cadJobs)
    .set({ cancelRequestedAt: new Date() })
    .where(and(eq(cadJobs.id, jobId), isNull(cadJobs.cancelRequestedAt)));

  return Response.json({ ok: true });
}
