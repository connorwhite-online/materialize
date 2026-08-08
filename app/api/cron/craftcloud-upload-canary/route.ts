import { logError } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/auth/constant-time-equal";
import {
  CraftCloudUploadError,
  uploadModelToCraftCloud,
} from "@/lib/craftcloud/model-upload";
import {
  buildCanarySolid,
  CANARY_FILENAME,
} from "@/lib/craftcloud/canary-solid";

/**
 * Hourly synthetic upload against the real CraftCloud chain.
 *
 * Why this exists: in Aug 2026 CraftCloud removed `POST /v5/model`
 * with no notice. Every print broke, and we found out because a
 * customer hit it — the only signal was a red alert on a page nobody
 * was watching. The upload chain is a third-party dependency we do not
 * control, is not covered by their public spec, and has already been
 * changed underneath us once. This turns the next such change from
 * "a customer told us" into "Sentry told us within the hour".
 *
 * It exercises the whole chain end to end — initiate, the presigned
 * S3 PUT, and confirm — against the live service. Unit tests can only
 * prove we speak the protocol we *think* CraftCloud speaks; only a
 * real request proves that is still true.
 *
 * Deliberately NOT covered: quoting. A price request fans out to real
 * vendors on CraftCloud's side, and doing that hourly to assert
 * something we don't currently suspect is a poor citizen. Upload is
 * the leg that broke and the leg with no spec.
 *
 * Cost per run: one ~284-byte model. CraftCloud exposes no delete, so
 * each run leaves a tiny orphan model on their side — the reason this
 * is hourly rather than every few minutes.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Wired in vercel.json. To run locally:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/craftcloud-upload-canary
 */

export const dynamic = "force-dynamic";

// The chain retries transient failures internally (200ms + 800ms of
// backoff across two retryable legs), so a slow run can legitimately
// take a while before it gives up.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    logError(
      "cron/craftcloud-upload-canary.auth",
      new Error("CRON_SECRET not configured")
    );
    return Response.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!auth || !constantTimeEqual(auth, `Bearer ${expected}`)) {
    logError(
      "cron/craftcloud-upload-canary.auth",
      new Error("Unauthorized cron request")
    );
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Mock mode is the default (`CRAFTCLOUD_USE_MOCK !== "false"`), and a
  // canary that never touches CraftCloud asserts nothing. Skip loudly
  // rather than reporting a green run that proves nothing.
  if (process.env.CRAFTCLOUD_USE_MOCK !== "false") {
    return Response.json({
      skipped: true,
      reason: "CRAFTCLOUD_USE_MOCK is not 'false' — canary needs the live API",
    });
  }

  const startedAt = Date.now();

  try {
    const model = await uploadModelToCraftCloud(
      buildCanarySolid(),
      CANARY_FILENAME,
      "mm"
    );

    const durationMs = Date.now() - startedAt;
    const result = {
      ok: true,
      modelId: model.modelId,
      durationMs,
      // Surfaced so a silent geometry regression (CraftCloud parsing
      // our tetrahedron into nothing) is visible in the cron log even
      // while the upload itself "succeeds".
      hasDimensions: model.dimensions !== null,
      isParsing: model.isParsing,
    };
    console.log("[cron/craftcloud-upload-canary]", result);
    return Response.json(result);
  } catch (error) {
    const durationMs = Date.now() - startedAt;

    // logError fans out to Sentry. The step is in the message so the
    // issue title itself says which leg died — the difference between
    // "CraftCloud is down" and "they changed the contract again".
    if (error instanceof CraftCloudUploadError) {
      logError("cron/craftcloud-upload-canary", {
        message: `CraftCloud upload canary failed at ${error.step}`,
        step: error.step,
        status: error.status,
        responseBody: error.responseBody.slice(0, 500),
        durationMs,
      });
      return Response.json(
        {
          ok: false,
          step: error.step,
          status: error.status,
          durationMs,
        },
        { status: 502 }
      );
    }

    logError("cron/craftcloud-upload-canary", error);
    return Response.json(
      { ok: false, error: "Canary failed", durationMs },
      { status: 500 }
    );
  }
}
