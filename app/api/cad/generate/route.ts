import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cadGenerations } from "@/lib/db/schema";
import { logError } from "@/lib/logger";
import { canUseTextToCad } from "@/lib/features";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";
import { runHarness, type PriorFeedback } from "@/lib/cad/harness";
import {
  generativeEnabled,
  shouldUseGenerative,
  runGenerative,
} from "@/lib/cad/generative";
import type { PromptImage } from "@/lib/cad/model-client";
import {
  persistGenerationFailure,
  persistGenerationSuccess,
} from "@/lib/cad/persist";
import type { CadStreamEvent } from "@/lib/cad/types";

/**
 * Streaming generate endpoint for the text-to-CAD studio.
 *
 * The non-streaming server action (app/actions/cad-generation.ts) returns
 * only the final result; this route exists so the studio can show what the
 * harness is doing in real time (write code -> run kernel -> validate ->
 * repair). It runs the same gate + harness + persistence, but emits the
 * harness's progress events as Server-Sent Events and appends a terminal
 * `done`/`error` event. Per AGENTS.md, a long-lived loop the client consumes
 * directly belongs in a route, not behind a server action.
 */

export const dynamic = "force-dynamic";
// The harness makes multiple model round-trips plus a sidecar call per repair
// attempt — well past the default serverless budget. Prod must run on a plan
// that allows this (and host the sidecar); see AGENTS.md production notes.
export const maxDuration = 300;

function sse(event: CadStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

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
    parentGenerationId?: string;
    name?: string;
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
  // it belongs to the caller.
  let priorSourceCode: string | null = null;
  let priorFeedback: PriorFeedback | null = null;
  if (body.parentGenerationId) {
    const [parent] = await db
      .select({
        sourceCode: cadGenerations.sourceCode,
        userId: cadGenerations.userId,
        rating: cadGenerations.rating,
        feedbackTags: cadGenerations.feedbackTags,
        feedbackNote: cadGenerations.feedbackNote,
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
  }

  const isRoot = !body.parentGenerationId;
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CadStreamEvent) => {
        try {
          controller.enqueue(sse(event));
        } catch {
          /* controller already closed (client gone) */
        }
      };

      try {
        // Route organic/sculptural forms to the generative backend (fal.ai)
        // when it's enabled; everything else stays on build123d. The classifier
        // only runs when FAL_KEY is set, so otherwise there's zero overhead.
        const useGenerative =
          generativeEnabled() &&
          (await shouldUseGenerative(prompt, request.signal));

        const result = useGenerative
          ? await runGenerative({
              prompt,
              images: images.length ? images : undefined,
              signal: request.signal,
              onProgress: (event) => send(event),
            })
          : await runHarness({
              prompt,
              priorSourceCode,
              priorFeedback,
              images: images.length ? images : undefined,
              signal: request.signal,
              onProgress: (event) => send(event),
            });

        if (!result.ok || !result.run) {
          const failed = await persistGenerationFailure(
            generationId,
            result.error ?? "Could not produce a valid model.",
            result.sourceCode,
            result.attempts
          );
          send({ type: "error", error: failed.error, generationId });
          return;
        }

        const persisted = await persistGenerationSuccess({
          userId,
          generationId,
          prompt,
          isRoot,
          // Revisions inherit the thread's current name from the client.
          nameOverride: body.name,
          result,
        });

        if ("error" in persisted) {
          send({ type: "error", error: persisted.error, generationId });
          return;
        }

        send({
          type: "done",
          generationId: persisted.generationId,
          fileAssetId: persisted.fileAssetId,
          fileSlug: persisted.fileSlug,
          renderUrl: persisted.renderUrl,
          sourceCode: persisted.sourceCode,
          title: persisted.title,
          parts: persisted.parts,
          projectSlug: persisted.projectSlug,
          remeshed: persisted.remeshed,
        });
      } catch (error) {
        // A client disconnect aborts the request signal — not a real failure.
        if ((error as Error)?.name !== "AbortError") {
          logError("api/cad/generate", error);
          await persistGenerationFailure(
            generationId,
            "Generation failed. Please try again."
          ).catch(() => undefined);
          send({
            type: "error",
            error: "Generation failed. Please try again.",
            generationId,
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush as they happen.
      "X-Accel-Buffering": "no",
    },
  });
}
