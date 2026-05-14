/**
 * Sentry wiring smoke test. Visit this route to intentionally
 * throw an error and confirm it lands in the Sentry dashboard.
 *
 * Gated three ways so it can't be abused:
 *   1. Disabled in production (NODE_ENV check).
 *   2. Requires a header secret matching SENTRY_TEST_SECRET, so
 *      even on a preview deploy a stranger can't trigger noise.
 *   3. Optional kind parameter exercises both code paths (error
 *      object vs. plain message).
 *
 * Usage from a local dev server:
 *
 *   curl -H "x-sentry-test-secret: $SENTRY_TEST_SECRET" \\
 *     http://localhost:3000/api/internal/sentry-test
 *
 * If wiring is correct: the request returns 500, the dev console
 * shows the [sentry-test] error line, and the Sentry dashboard
 * receives a new event tagged context=sentry-test.
 */
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Disabled in production" }, { status: 404 });
  }

  const expected = process.env.SENTRY_TEST_SECRET;
  if (!expected) {
    return Response.json(
      {
        error:
          "SENTRY_TEST_SECRET not set — add it to .env.local to enable this probe",
      },
      { status: 500 }
    );
  }
  if (request.headers.get("x-sentry-test-secret") !== expected) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Throw, catch, log — same pattern every server action uses.
  // The catch routes through logError, which now fans out to
  // Sentry.captureException.
  try {
    throw new Error(
      `Sentry wiring smoke test fired at ${new Date().toISOString()}`
    );
  } catch (err) {
    logError("sentry-test", err);
    return Response.json(
      { ok: false, reported: true, message: "Smoke event sent to Sentry" },
      { status: 500 }
    );
  }
}
