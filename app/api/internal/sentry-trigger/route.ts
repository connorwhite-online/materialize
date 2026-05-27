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
 *        against `SENTRY_TRIGGER_SECRET`. This mode is OFF by default
 *        — a single static header has no replay protection, so a
 *        leaked secret would let an attacker fire arbitrary agent
 *        runs. It is only honored when
 *        `SENTRY_TRIGGER_ALLOW_SHARED_SECRET` is explicitly enabled,
 *        and only for requests inside a short freshness window
 *        (see `X-Sentry-Trigger-Timestamp`).
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
 *       a custom header. INERT unless
 *       SENTRY_TRIGGER_ALLOW_SHARED_SECRET is also enabled.
 *   Plus:
 *     GITHUB_DISPATCH_TOKEN — PAT with `actions:write` scope on
 *       the repo.
 *     GITHUB_REPO — `owner/repo` (e.g. "connor/materialize").
 *
 * Env optional:
 *   SENTRY_TRIGGER_ALLOW_SHARED_SECRET — opt-in flag that enables the
 *     shared-header (`X-Sentry-Trigger-Secret`) auth mode. OFF by
 *     default: with the flag unset we require HMAC and ignore the
 *     shared header entirely, even if SENTRY_TRIGGER_SECRET is set.
 *     Set to `1`/`true`/`yes`/`on` to enable manual `curl` triggers.
 *     When enabled, requests must also carry a recent
 *     `X-Sentry-Trigger-Timestamp` (see below).
 *   SENTRY_TRIGGER_TIMESTAMP_WINDOW_SECONDS — freshness window (in
 *     seconds) for the shared-secret replay guard. Defaults to 300.
 *   SENTRY_TRIGGER_ENVIRONMENT — comma-separated allowlist of Sentry
 *     environments that should dispatch a fix. Defaults to
 *     `production`, which is the only deploy we want a real agent
 *     run for. Set to `*` to disable filtering entirely (every event
 *     dispatches regardless of environment tag). Events with no
 *     environment field are skipped under the default.
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

  // Shared-secret fallback. OFF by default: a single static header
  // has no replay protection, so a leaked SENTRY_TRIGGER_SECRET would
  // let an attacker fire arbitrary agent runs. Only honor it when the
  // operator explicitly opts in via SENTRY_TRIGGER_ALLOW_SHARED_SECRET
  // (e.g. to keep the documented manual `curl` test path working).
  const sharedSecretAllowed = isSharedSecretModeEnabled(
    process.env.SENTRY_TRIGGER_ALLOW_SHARED_SECRET
  );
  if (!authed && sharedSecret && sharedSecretAllowed) {
    const provided = request.headers.get("x-sentry-trigger-secret");
    if (provided && constantTimeStringEqual(provided, sharedSecret)) {
      // Even with the right secret, require a recent timestamp so a
      // captured request can't be replayed indefinitely. The window
      // is small but generous enough for hand-run curl commands.
      const freshness = checkSharedSecretFreshness(
        request.headers.get("x-sentry-trigger-timestamp"),
        process.env.SENTRY_TRIGGER_TIMESTAMP_WINDOW_SECONDS,
        Date.now()
      );
      if (freshness.ok) {
        authed = true;
      } else {
        return Response.json(
          { error: "Forbidden", reason: freshness.reason },
          { status: 403 }
        );
      }
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

  // Skip events from environments the agent shouldn't touch. The
  // default is production-only because a fresh agent run costs
  // real money + opens a real PR; dev errors should stay in the
  // local terminal where the engineer can deal with them
  // directly. `*` disables filtering for anyone running staging
  // or preview triage. Events with no environment field are
  // skipped under the default — Sentry's SDK populates the field
  // automatically for real events, so absence is a signal the
  // payload came from a hand-crafted test rather than a deploy.
  const environment = readEnvironment(flattened);
  const decision = decideEnvironmentDispatch(
    environment,
    process.env.SENTRY_TRIGGER_ENVIRONMENT
  );
  if (!decision.dispatch) {
    return Response.json({
      skipped: decision.reason,
      environment: environment ?? null,
      allowed: decision.allowed,
      eventId,
    });
  }

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
 * Read the environment tag off a flattened Sentry event. Sentry
 * populates this from `Sentry.init({ environment })` — see
 * `sentry.server.config.ts:25` where we set it from
 * `VERCEL_ENV ?? NODE_ENV`. Returns null when missing or empty so
 * the caller can apply its own default.
 */
export function readEnvironment(
  flattened: Record<string, unknown>
): string | null {
  const raw = flattened.environment;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export type EnvironmentDispatchDecision =
  | { dispatch: true; allowed: string[] | "*" }
  | {
      dispatch: false;
      allowed: string[] | "*";
      reason: "non-allowed-environment" | "missing-environment";
    };

/**
 * Resolve the SENTRY_TRIGGER_ENVIRONMENT config into a dispatch
 * decision for one event.
 *
 * - `*` (wildcard) — always dispatch, even for events with no
 *   environment tag.
 * - missing config — defaults to `["production"]`.
 * - comma-separated list — case-insensitive exact match against
 *   `event.environment`.
 *
 * Returning a structured decision instead of a bare boolean lets
 * the route surface "why was this skipped?" in the response body,
 * which is what we read in tests and in the Sentry delivery log.
 */
export function decideEnvironmentDispatch(
  environment: string | null,
  rawConfig: string | undefined
): EnvironmentDispatchDecision {
  const config = rawConfig?.trim();
  if (config === "*") {
    return { dispatch: true, allowed: "*" };
  }
  const allowed = (config && config.length > 0 ? config : "production")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (!environment) {
    return { dispatch: false, allowed, reason: "missing-environment" };
  }
  if (allowed.includes(environment.toLowerCase())) {
    return { dispatch: true, allowed };
  }
  return { dispatch: false, allowed, reason: "non-allowed-environment" };
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
export function extractEventLike(
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
 * Whether the shared-secret (`X-Sentry-Trigger-Secret`) auth mode is
 * enabled. OFF unless the operator opts in, because a static header
 * has no replay protection — by default we require HMAC. Accepts the
 * usual truthy spellings; anything else (including unset) is false.
 */
export function isSharedSecretModeEnabled(
  rawFlag: string | undefined
): boolean {
  if (typeof rawFlag !== "string") return false;
  const normalized = rawFlag.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export type SharedSecretFreshness =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-timestamp" | "malformed-timestamp" | "stale-timestamp";
    };

/**
 * Replay guard for the shared-secret path. The caller must send an
 * `X-Sentry-Trigger-Timestamp` header (Unix seconds; milliseconds are
 * also accepted) within `windowSeconds` of now. Without this a single
 * captured request could be replayed forever; with it a captured
 * request expires quickly.
 *
 * Defaults to a 300s window. Future timestamps are bounded by the same
 * window so a skewed-forward clock can't grant an unbounded lifetime.
 */
export function checkSharedSecretFreshness(
  rawTimestamp: string | null,
  rawWindowSeconds: string | undefined,
  nowMs: number
): SharedSecretFreshness {
  if (rawTimestamp === null || rawTimestamp.trim().length === 0) {
    return { ok: false, reason: "missing-timestamp" };
  }
  const parsed = Number(rawTimestamp.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, reason: "malformed-timestamp" };
  }
  // Heuristic: values that look like milliseconds (>= ~1e12) are
  // treated as ms; smaller values are treated as seconds.
  const timestampMs = parsed >= 1e12 ? parsed : parsed * 1000;

  const windowSeconds = parseWindowSeconds(rawWindowSeconds);
  const windowMs = windowSeconds * 1000;
  if (Math.abs(nowMs - timestampMs) > windowMs) {
    return { ok: false, reason: "stale-timestamp" };
  }
  return { ok: true };
}

const DEFAULT_TIMESTAMP_WINDOW_SECONDS = 300;

function parseWindowSeconds(raw: string | undefined): number {
  if (typeof raw !== "string") return DEFAULT_TIMESTAMP_WINDOW_SECONDS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMESTAMP_WINDOW_SECONDS;
  }
  return parsed;
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
