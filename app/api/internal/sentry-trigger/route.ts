import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { logError } from "@/lib/logger";

/**
 * Vercel webhook entrypoint for the sentry-fixer agent loop.
 *
 * Flow:
 *   1. Sentry alert fires.
 *   2. Sentry POSTs the event JSON here. We accept two auth modes:
 *      - **HMAC mode** (Sentry's native Internal Integration path):
 *        verify the `Sentry-Hook-Signature` header against an
 *        HMAC-SHA-256 of the raw body, keyed by the integration's
 *        Client Secret in `SENTRY_INTEGRATION_CLIENT_SECRET`.
 *      - **Shared-header mode** (manual triggers / providers that
 *        let you set custom headers): match `X-Sentry-Trigger-Secret`
 *        against `SENTRY_TRIGGER_SECRET`.
 *      Either path works; at least one must be configured.
 *   3. Extract the event id + the full payload and dispatch the
 *      `sentry-fixer` GitHub Action with both as inputs.
 *   4. The Action runs scripts/sentry-fixer.ts on a fresh
 *      ubuntu-latest runner. Wall-clock for the actual agent work
 *      lives there, not here — Vercel functions have a 60s cap
 *      which is far too short.
 *
 * Why GitHub Actions instead of an in-Vercel runner:
 *   - Wall-clock: Vercel's 60s cap doesn't fit a 5-30 minute agent
 *     session.
 *   - Isolation: a fresh checkout per run is closer to what a human
 *     engineer would do than reusing function state.
 *   - Tooling: Playwright browsers, Stripe sandbox calls, Neon DB
 *     branching all live in CI naturally.
 *
 * Env required:
 *   At least one of:
 *     SENTRY_INTEGRATION_CLIENT_SECRET — the Client Secret on a
 *       Sentry Internal Integration; we HMAC-verify
 *       `Sentry-Hook-Signature` against it.
 *     SENTRY_TRIGGER_SECRET — shared secret matching what the
 *       webhook sender posts in `X-Sentry-Trigger-Secret`. Useful
 *       for manual triggers or webhook providers that let you set
 *       a custom header.
 *   Plus:
 *     GITHUB_DISPATCH_TOKEN — PAT with `actions:write` scope on
 *       the repo.
 *     GITHUB_REPO — `owner/repo` (e.g. "connor/materialize").
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const sharedSecret = process.env.SENTRY_TRIGGER_SECRET;
  const hmacSecret = process.env.SENTRY_INTEGRATION_CLIENT_SECRET;
  if (!sharedSecret && !hmacSecret) {
    return Response.json(
      {
        error:
          "Neither SENTRY_INTEGRATION_CLIENT_SECRET nor SENTRY_TRIGGER_SECRET configured — webhook is wired but inert",
      },
      { status: 503 }
    );
  }

  // Read the raw body ONCE — HMAC verification needs the exact
  // bytes Sentry signed, so we can't parse JSON first and then
  // re-stringify (key order, whitespace changes break the
  // signature).
  const rawBody = await request.text();

  // Try HMAC first — that's the Sentry-native path. Fall back to
  // the shared header if HMAC isn't configured or the signature
  // doesn't match.
  let authed = false;

  if (hmacSecret) {
    const provided = request.headers.get("sentry-hook-signature");
    if (provided) {
      const computed = createHmac("sha256", hmacSecret)
        .update(rawBody)
        .digest("hex");
      // node:crypto's timingSafeEqual requires equal-length Buffers.
      // A length mismatch can't be a valid signature anyway.
      if (provided.length === computed.length) {
        try {
          if (
            nodeTimingSafeEqual(
              Buffer.from(provided, "utf8"),
              Buffer.from(computed, "utf8")
            )
          ) {
            authed = true;
          }
        } catch {
          // Buffer length mismatch from utf8 encoding shouldn't
          // happen for hex strings, but guard anyway.
        }
      }
    }
  }

  if (!authed && sharedSecret) {
    const provided = request.headers.get("x-sentry-trigger-secret");
    if (provided && constantTimeStringEqual(provided, sharedSecret)) {
      authed = true;
    }
  }

  if (!authed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let rawEvent: Record<string, unknown>;
  try {
    rawEvent = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Normalize the many shapes Sentry uses to deliver event/issue
  // info. Across alert-rule webhooks, Internal Integration issue
  // hooks, and our own manual triggers, the actionable payload
  // turns up in one of these spots:
  //
  //   - top-level (manual curl with a flat event object)
  //   - { event: {...} } (alert-rule webhook)
  //   - { data: { issue: {...} } } (Internal Integration issue hook)
  //   - { data: { event: {...} } } (Internal Integration event hook)
  //
  // The flattened payload is what we hand the agent — the prompt
  // builder reads stack frames, message, tags, etc. off it. If
  // Sentry delivered just issue metadata (no full event), we still
  // pass enough for the agent to grep the codebase for the
  // culprit string and the issue title.
  const flattened = extractEventLike(rawEvent);
  const eventId =
    (flattened.event_id as string | undefined) ??
    (flattened.id as string | undefined) ??
    (flattened.shortId as string | undefined) ??
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
 * Walk a Sentry webhook payload down to the most informative
 * event-like object. Returns the inner payload (with all the
 * fields the agent's prompt builder cares about) instead of the
 * outer envelope. If multiple envelope shapes are present (e.g.
 * both `event` and `data.issue`), prefer whichever has the most
 * actionable detail.
 *
 * Falls back to the original object if none of the known wrappers
 * are present — manually-crafted test events come in flat.
 */
function extractEventLike(
  payload: Record<string, unknown>
): Record<string, unknown> {
  // Internal Integration sends issue + event under `data`
  const data = isObject(payload.data) ? payload.data : null;
  if (data) {
    if (isObject(data.event)) return data.event;
    if (isObject(data.issue)) return data.issue;
  }
  // Alert-rule webhook nests under `event`
  if (isObject(payload.event)) return payload.event;
  return payload;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Constant-time string compare for the shared-secret path. We use
 * a hand-rolled version (instead of node:crypto's timingSafeEqual)
 * because we want to short-circuit on length mismatch — the secret
 * length isn't itself secret (the user picks it and stores it in
 * env), so leaking it via timing is fine.
 */
function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
