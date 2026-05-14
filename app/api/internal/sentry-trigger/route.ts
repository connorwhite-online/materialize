import { logError } from "@/lib/logger";

/**
 * Vercel webhook entrypoint for the sentry-fixer agent loop.
 *
 * Flow:
 *   1. Sentry alert fires.
 *   2. Sentry posts the event JSON here. We validate a shared
 *      secret header (configured in Sentry's webhook UI as
 *      `X-Sentry-Trigger-Secret`).
 *   3. We extract the event id + the full payload and dispatch
 *      the `sentry-fixer` GitHub Action with both as inputs.
 *   4. The Action runs scripts/sentry-fixer.ts on a fresh
 *      ubuntu-latest runner. Wall-clock for the actual agent
 *      work lives there, not here — Vercel functions have a
 *      60s cap which is far too short.
 *
 * Why GitHub Actions instead of an in-Vercel runner:
 *   - Wall-clock: Vercel's 60s cap doesn't fit a 5-30 minute
 *     agent session.
 *   - Isolation: a fresh checkout per run is closer to what
 *     a human engineer would do than reusing function state.
 *   - Tooling: Playwright browsers, Stripe sandbox calls,
 *     Neon DB branching all live in CI naturally.
 *
 * Env required:
 *   SENTRY_TRIGGER_SECRET   — shared secret matching what
 *     Sentry posts in `X-Sentry-Trigger-Secret`
 *   GITHUB_DISPATCH_TOKEN   — PAT with `actions:write` scope on
 *     the repo
 *   GITHUB_REPO             — `owner/repo` (e.g. "connor/materialize")
 *
 * Future upgrade: switch the simple shared-secret validation to
 * full HMAC-SHA-256 verification via `sentry-hook-signature`
 * (the header Sentry's internal-integrations webhook sends). The
 * upgrade path is documented in docs/observability.md.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const expectedSecret = process.env.SENTRY_TRIGGER_SECRET;
  if (!expectedSecret) {
    return Response.json(
      {
        error:
          "SENTRY_TRIGGER_SECRET not configured — webhook is wired but inert",
      },
      { status: 503 }
    );
  }

  const provided = request.headers.get("x-sentry-trigger-secret");
  if (!provided || !timingSafeEqual(provided, expectedSecret)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let event: { event_id?: string; id?: string } & Record<string, unknown>;
  try {
    event = (await request.json()) as typeof event;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Sentry's webhook payload nests the event inside an `event`
  // property when sent via the alert-rule webhook; internal-
  // integration payloads put it at the top level. Accept both.
  const flattened =
    typeof (event as { event?: unknown }).event === "object" &&
    (event as { event?: unknown }).event !== null
      ? ((event as { event: Record<string, unknown> }).event)
      : event;
  const eventId =
    (flattened.event_id as string | undefined) ??
    (flattened.id as string | undefined) ??
    "unknown";

  const repo = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!repo || !token) {
    return Response.json(
      {
        error:
          "GITHUB_REPO / GITHUB_DISPATCH_TOKEN missing — cannot dispatch workflow",
      },
      { status: 503 }
    );
  }

  const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/sentry-fixer.yml/dispatches`;

  try {
    const res = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          // GitHub workflow inputs cap at ~65k chars; Sentry events
          // are well under that. Stringify once to send.
          sentry_event: JSON.stringify(flattened),
          event_id: eventId,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      logError("sentry-trigger.dispatch", new Error(
        `GitHub dispatch returned ${res.status}: ${detail}`
      ));
      return Response.json(
        { error: "Workflow dispatch failed", status: res.status },
        { status: 502 }
      );
    }

    return Response.json({ dispatched: true, eventId });
  } catch (err) {
    logError("sentry-trigger.dispatch", err);
    return Response.json({ error: "Dispatch errored" }, { status: 500 });
  }
}

/**
 * Constant-time string compare to defeat timing oracles on the
 * shared secret check. Length mismatch returns false immediately
 * — that's not a timing leak because the secret length isn't
 * itself secret (the user picks it and stores it in env).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
