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
 *      - **Shared-header mode**: match `X-Sentry-Trigger-Secret`
 *        against `SENTRY_TRIGGER_SECRET`, plus a freshness signal
 *        so a captured request cannot be replayed forever.
 *        Sentry-native freshness (`Sentry-Hook-Timestamp`, or the
 *        event's `timestamp`/`datetime`) is always accepted — that's
 *        what Alert Rule webhooks can actually send. The curl header
 *        `X-Sentry-Trigger-Timestamp` is only honored when
 *        `SENTRY_TRIGGER_ALLOW_SHARED_SECRET` is on (or HMAC is not
 *        configured, so shared-secret is the only path).
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
 *       webhook sender posts in `X-Sentry-Trigger-Secret`. Honored
 *       when the request also carries Sentry-native freshness, or
 *       (for manual curls) when SENTRY_TRIGGER_ALLOW_SHARED_SECRET
 *       is enabled.
 *   Plus:
 *     GITHUB_DISPATCH_TOKEN — PAT with `actions:write` scope on
 *       the repo.
 *     GITHUB_REPO — `owner/repo` (e.g. "connor/materialize").
 *
 * Env optional:
 *   SENTRY_TRIGGER_ALLOW_SHARED_SECRET — opt-in flag that enables
 *     the manual `curl` path (`X-Sentry-Trigger-Timestamp`). Alert
 *     Rule + Internal Integration deliveries do not need this flag;
 *     they authenticate via HMAC or Sentry-native freshness.
 *   SENTRY_TRIGGER_TIMESTAMP_WINDOW_SECONDS — freshness window (in
 *     seconds) for header-based replay guards. Defaults to 300.
 *     Payload timestamps (Alert Rule `event.timestamp`) use a
 *     longer default (7200) because an alert can fire on a burst
 *     whose first event is minutes old.
 *   SENTRY_TRIGGER_ENVIRONMENT — comma-separated allowlist of Sentry
 *     environments that should dispatch a fix. Defaults to
 *     `production`, which is the only deploy we want a real agent
 *     run for. Set to `*` to disable filtering entirely (every event
 *     dispatches regardless of environment tag). Events with no
 *     environment field are always skipped under the default —
 *     Internal Integration `issue.created` payloads omit the field,
 *     so they do not dispatch. Use an Alert Rule or an `error`
 *     webhook (both carry `event.environment`) so preview / local
 *     testing cannot start a run.
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
  // doesn't match (Alert Rules never send Sentry-Hook-Signature).
  let hmacAuthed = false;

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
            hmacAuthed = true;
          }
        } catch {
          // Buffer length mismatch from utf8 encoding shouldn't
          // happen for hex strings, but guard anyway.
        }
      }
    }
  }

  let rawEvent: Record<string, unknown> | null = null;
  try {
    rawEvent = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    rawEvent = null;
  }

  let authed = hmacAuthed;

  // Shared-secret fallback. A static header alone is not enough —
  // we also need a freshness signal so a captured request expires.
  // Sentry Alert Rules can send the secret but not a custom
  // timestamp header; they DO send event.timestamp / datetime
  // (and Internal Integration sends Sentry-Hook-Timestamp).
  // The curl header stays flag-gated so a leaked secret plus
  // `date +%s` is not enough unless the operator opted in.
  if (!authed && sharedSecret) {
    const provided = request.headers.get("x-sentry-trigger-secret");
    if (provided && constantTimeStringEqual(provided, sharedSecret)) {
      const flagOn = isSharedSecretModeEnabled(
        process.env.SENTRY_TRIGGER_ALLOW_SHARED_SECRET
      );
      const flattenedForTs = rawEvent ? extractEventLike(rawEvent) : null;
      const timestamp = resolveSharedSecretTimestamp({
        sentryHookTimestamp: request.headers.get("sentry-hook-timestamp"),
        curlTimestamp: request.headers.get("x-sentry-trigger-timestamp"),
        payload: flattenedForTs,
        envelope: rawEvent,
        allowCurlHeader: flagOn || !hmacSecret,
      });
      if (!timestamp) {
        return Response.json(
          { error: "Forbidden", reason: "missing-timestamp" },
          { status: 403 }
        );
      }
      const freshness = checkSharedSecretFreshness(
        timestamp.value,
        process.env.SENTRY_TRIGGER_TIMESTAMP_WINDOW_SECONDS,
        Date.now(),
        {
          defaultWindowSeconds:
            timestamp.source === "payload"
              ? PAYLOAD_TIMESTAMP_WINDOW_SECONDS
              : DEFAULT_TIMESTAMP_WINDOW_SECONDS,
        }
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

  if (!rawEvent) {
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

  // Issue lifecycle webhooks fire on assigned/resolved/archived too.
  // Only `created` should spawn a fixer run.
  const actionability = isActionableSentryDelivery(
    rawEvent,
    request.headers.get("sentry-hook-resource")
  );
  if (!actionability.dispatch) {
    return Response.json({
      skipped: actionability.reason,
      eventId,
    });
  }

  // Skip events from environments the agent shouldn't touch. The
  // default is production-only because a fresh agent run costs
  // real money + opens a real PR; preview / local errors stay in
  // the terminal or the Sentry dashboard. `*` disables filtering
  // for anyone running staging or preview triage.
  //
  // Missing environment is a skip, HMAC or not. Official
  // `issue.created` payloads omit the field, and treating that as
  // "dispatch" would fire on the first occurrence of a preview
  // or local error (CON-15). Alert Rules and `error` webhooks
  // carry `event.environment`; those are the production path.
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
 * `VERCEL_ENV ?? NODE_ENV`. Also accepts `tags.environment` in
 * either object or `{key,value}[]` form. Returns null when
 * missing or empty so the caller can apply its own default.
 */
export function readEnvironment(
  flattened: Record<string, unknown>
): string | null {
  const fromField = asNonEmptyString(flattened.environment);
  if (fromField) return fromField;

  const tags = flattened.tags;
  if (isObject(tags)) {
    const fromObjectTag = asNonEmptyString(tags.environment);
    if (fromObjectTag) return fromObjectTag;
  }
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (!isObject(tag)) continue;
      const key = asNonEmptyString(tag.key) ?? asNonEmptyString(tag.name);
      if (key !== "environment") continue;
      const fromArrayTag = asNonEmptyString(tag.value);
      if (fromArrayTag) return fromArrayTag;
    }
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
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
 * Missing environment is always a skip under the default. HMAC
 * does not change that — `issue.created` has no environment
 * field, and guessing "production" would fire on preview / local
 * first-seen issues.
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

const NON_ACTIONABLE_RESOURCES = new Set([
  "installation",
  "comment",
  "seer",
  "preprod_artifact",
  "metric_alert",
]);

export type SentryActionability =
  | { dispatch: true }
  | {
      dispatch: false;
      reason: "non-actionable-issue-action" | "non-actionable-resource";
    };

/**
 * Whether this Sentry delivery should spawn a fixer run.
 *
 * Internal Integration issue webhooks fire on every lifecycle
 * change (`assigned`, `resolved`, `archived`, …). Only
 * `issue.created` is a new error. Other resources (installation
 * handshake, comments, metric alerts) are never actionable.
 */
export function isActionableSentryDelivery(
  payload: Record<string, unknown>,
  resourceHeader: string | null
): SentryActionability {
  const resource = resourceHeader?.trim().toLowerCase() ?? "";
  const action =
    typeof payload.action === "string"
      ? payload.action.trim().toLowerCase()
      : "";
  const data = isObject(payload.data) ? payload.data : null;
  const isIssueEnvelope =
    resource === "issue" || (data !== null && isObject(data.issue));

  if (isIssueEnvelope) {
    // Missing action: treat as created-equivalent (flat/manual
    // payloads, or an Alert Rule that nested an issue).
    if (action === "" || action === "created") {
      return { dispatch: true };
    }
    return { dispatch: false, reason: "non-actionable-issue-action" };
  }

  if (resource && NON_ACTIONABLE_RESOURCES.has(resource)) {
    return { dispatch: false, reason: "non-actionable-resource" };
  }

  return { dispatch: true };
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
 * Whether the shared-secret curl header (`X-Sentry-Trigger-Timestamp`)
 * is enabled. OFF unless the operator opts in. Alert Rule / Internal
 * Integration freshness does not go through this flag. Accepts the
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

export type SharedSecretTimestampSource = "sentry-hook" | "curl" | "payload";

export type SharedSecretTimestamp = {
  value: string;
  source: SharedSecretTimestampSource;
};

/**
 * Pick a freshness signal for the shared-secret path.
 *
 * Priority: Sentry-Hook-Timestamp (Internal Integration) → curl
 * header when allowed → event.timestamp / datetime on the payload.
 */
export function resolveSharedSecretTimestamp(input: {
  sentryHookTimestamp: string | null;
  curlTimestamp: string | null;
  payload: Record<string, unknown> | null;
  envelope: Record<string, unknown> | null;
  allowCurlHeader: boolean;
}): SharedSecretTimestamp | null {
  const hook = input.sentryHookTimestamp?.trim();
  if (hook) return { value: hook, source: "sentry-hook" };

  if (input.allowCurlHeader) {
    const curl = input.curlTimestamp?.trim();
    if (curl) return { value: curl, source: "curl" };
  }

  const fromPayload =
    readPayloadTimestamp(input.payload) ?? readPayloadTimestamp(input.envelope);
  if (fromPayload) return { value: fromPayload, source: "payload" };

  return null;
}

/**
 * Read a unix-seconds / unix-ms / ISO timestamp off a Sentry
 * event-like object. Returns a numeric string checkSharedSecretFreshness
 * can parse, or null.
 */
export function readPayloadTimestamp(
  obj: Record<string, unknown> | null
): string | null {
  if (!obj) return null;
  if (typeof obj.timestamp === "number") {
    if (Number.isFinite(obj.timestamp) && obj.timestamp > 0) {
      return String(obj.timestamp);
    }
    return null;
  }
  if (typeof obj.timestamp === "string" && obj.timestamp.trim()) {
    const raw = obj.timestamp.trim();
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) return raw;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return String(ms);
  }
  if (typeof obj.datetime === "string" && obj.datetime.trim()) {
    const ms = Date.parse(obj.datetime.trim());
    if (Number.isFinite(ms)) return String(ms);
  }
  return null;
}

/**
 * Replay guard for the shared-secret path. The caller must present
 * a timestamp (Unix seconds; milliseconds are also accepted) within
 * `windowSeconds` of now. Without this a single captured request
 * could be replayed forever; with it a captured request expires.
 *
 * Defaults to a 300s window for headers. Payload timestamps pass a
 * longer default because Alert Rules can fire on a burst whose
 * first event is minutes old. Future timestamps are bounded by the
 * same window so a skewed-forward clock can't grant an unbounded
 * lifetime.
 */
export function checkSharedSecretFreshness(
  rawTimestamp: string | null,
  rawWindowSeconds: string | undefined,
  nowMs: number,
  options?: { defaultWindowSeconds?: number }
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

  const fallback =
    options?.defaultWindowSeconds ?? DEFAULT_TIMESTAMP_WINDOW_SECONDS;
  const windowSeconds = parseWindowSeconds(rawWindowSeconds, fallback);
  const windowMs = windowSeconds * 1000;
  if (Math.abs(nowMs - timestampMs) > windowMs) {
    return { ok: false, reason: "stale-timestamp" };
  }
  return { ok: true };
}

const DEFAULT_TIMESTAMP_WINDOW_SECONDS = 300;
const PAYLOAD_TIMESTAMP_WINDOW_SECONDS = 7200;

function parseWindowSeconds(
  raw: string | undefined,
  fallback: number = DEFAULT_TIMESTAMP_WINDOW_SECONDS
): number {
  if (typeof raw !== "string") return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
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
