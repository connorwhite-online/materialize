import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { deriveParamRerunSource } from "@/lib/cad/features";
import { runCadCode } from "@/lib/cad/runner-client";
import { logError } from "@/lib/logger";
import { checkCadGenerateRateLimit } from "@/app/api/cad/generate/rate-limit";

/**
 * Live param preview for a feature chip (docs/text-to-cad/10 interaction
 * model): re-run the generation's source with a substituted draft and
 * stream back the STL — NO LLM, NO persistence, no generation row. The
 * studio swaps the viewer to this transient geometry while the user dials
 * a value; the ✓ commit goes through rerunCadWithParams, which derives the
 * SAME source via the shared deriveParamRerunSource, so what you previewed
 * is exactly what you commit.
 *
 * A route (not a server action) because the response is model bytes the
 * client feeds straight to STLLoader via an object URL — base64 through an
 * action would double the payload and hold it in React state.
 *
 * Cost/gating: a preview is a real sidecar exec, so it sits behind the
 * same generate rate-limit GATE as the commit path (being over the
 * generation limit blocks previews too). Previews create no rows, so they
 * never consume that window themselves — the client-side debounce is the
 * frequency governor, and the sidecar's serialized /run queue is the
 * capacity backstop.
 */

export const dynamic = "force-dynamic";
// One sidecar exec; heavy parts can legitimately take minutes under
// CAD_RUN_TIMEOUT_S. Fluid allows this alongside the generate route's 800.
export const maxDuration = 300;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const user = (await currentUser()) as ClerkUserLike;
  if (!canUseTextToCad(primaryEmail(user))) {
    return new Response("Not found", { status: 404 });
  }

  const rate = await checkCadGenerateRateLimit(userId);
  if (!rate.ok) {
    // Same copy the generate route's 429 uses.
    return Response.json(
      {
        error:
          `You've started ${rate.count} generations in the last ` +
          `${rate.windowMinutes} minutes. Give it a moment and try again.`,
      },
      { status: 429 }
    );
  }

  let body: {
    generationId?: string;
    featureId?: string;
    params?: Record<string, number>;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const generationId = body.generationId?.trim();
  if (!generationId || !body.params) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const [parent] = await db
      .select({
        sourceCode: cadGenerations.sourceCode,
        status: cadGenerations.status,
        engine: cadGenerations.engine,
        features: cadGenerations.features,
      })
      .from(cadGenerations)
      .where(
        and(
          eq(cadGenerations.id, generationId),
          eq(cadGenerations.userId, userId)
        )
      )
      .limit(1);
    if (!parent || parent.status !== "succeeded" || !parent.sourceCode) {
      return Response.json({ error: "Generation not found." }, { status: 404 });
    }

    const derived = deriveParamRerunSource({
      sourceCode: parent.sourceCode,
      featuresRaw: parent.features,
      featureId: body.featureId,
      params: body.params,
    });
    if ("error" in derived) {
      return Response.json({ error: derived.error }, { status: 422 });
    }

    // STL only — a preview needs geometry, not STEP/topo exports.
    const run = await runCadCode(derived.source, ["stl"], request.signal, {
      engine: parent.engine || "build123d",
    });
    if (!run.ok || !run.files.stl) {
      return Response.json(
        {
          error:
            run.error ||
            "Those values couldn't be built. Try a different number.",
        },
        { status: 422 }
      );
    }

    return new Response(Buffer.from(run.files.stl, "base64"), {
      status: 200,
      headers: {
        "Content-Type": "model/stl",
        // Transient by definition — never cache a draft preview.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    logError("api/cad/feature-preview", error);
    return Response.json({ error: "Preview failed." }, { status: 500 });
  }
}
