/**
 * Centralized server-side environment validation.
 *
 * Two layers:
 *
 *  1. `requireEnv(name)` — a lazy, per-call guard kept for the existing
 *     call sites (lib/storage.ts, lib/watermark/embed.ts). Throws a clear
 *     error the moment a single var is read but absent.
 *
 *  2. `validateServerEnv()` / `serverEnv` — a zod schema covering every
 *     REQUIRED server var, run ONCE at boot from `instrumentation.ts` so a
 *     misconfigured deployment fails fast with a single, named error
 *     instead of surfacing deep inside a request handler.
 *
 * Only server-side, required vars are validated. We deliberately do NOT
 * validate `NEXT_PUBLIC_*` (those are inlined at build time and belong to
 * the client) nor optional feature flags (CRAFTCLOUD_USE_MOCK, *_DRY_RUN,
 * Sentry tooling tokens, cron-trigger integration secrets, etc.).
 */
import { z } from "zod";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env.local file.`
    );
  }
  return value;
}

/**
 * Required server env. Every key here must be present and non-empty for
 * the app to boot. Add new HARD dependencies here; keep optional flags out.
 */
const baseServerEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1),

  // Auth (Clerk)
  CLERK_SECRET_KEY: z.string().min(1),
  // Only needed when the Clerk webhook route is hit — not required at boot
  CLERK_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Payments (Stripe)
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // Object storage (Cloudflare R2)
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),

  // Transactional email (Resend)
  RESEND_API_KEY: z.string().min(1),

  // Purchased-file watermarking (HMAC)
  WATERMARK_SECRET: z.string().min(1),

  // Cron / internal job auth — only needed when cron routes are hit
  CRON_SECRET: z.string().min(1).optional(),

  // CAD execution sidecar (SEC-4) — both optional on their own (an
  // unset CAD_RUNNER_URL is the supported "mock mode" local/CI
  // default), but a real CAD_RUNNER_URL with no CAD_RUNNER_SECRET
  // would silently send every sidecar request unauthenticated. The
  // cross-field rule enforcing that pairing lives in the
  // `.superRefine` below, mirroring `isCadRunnerMock()`'s branching.
  CAD_RUNNER_URL: z.string().min(1).optional(),
  CAD_RUNNER_SECRET: z.string().min(1).optional(),
  CAD_RUNNER_USE_MOCK: z.string().optional(),

  // CraftCloud checkout mock gate (SEC-5) — validated below alongside
  // STRIPE_SECRET_KEY so a live Stripe key can never pair with a
  // mocked CraftCloud checkout (lib/craftcloud/client.ts's USE_MOCK
  // defaults ON, so an unset var in prod would otherwise take real
  // Stripe money while fabricating craftCloudOrderIds).
  CRAFTCLOUD_USE_MOCK: z.string().optional(),
});

/**
 * Cross-field rules that can't be expressed as simple per-key
 * presence checks.
 */
const serverEnvSchema = baseServerEnvSchema.superRefine((env, ctx) => {
  // SEC-4 — a real (non-mock) CAD_RUNNER_URL requires
  // CAD_RUNNER_SECRET, mirroring the mock condition in
  // `isCadRunnerMock()` exactly — keep the two in sync by
  // construction if that branching ever changes.
  const runnerUrl = env.CAD_RUNNER_URL ?? "";
  const forcedMock = env.CAD_RUNNER_USE_MOCK === "true";
  const isMock = runnerUrl === "" || forcedMock;
  if (!isMock && !env.CAD_RUNNER_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CAD_RUNNER_SECRET"],
      message:
        "CAD_RUNNER_SECRET is required when CAD_RUNNER_URL is set and CAD_RUNNER_USE_MOCK is not \"true\" — an unauthenticated sidecar request would otherwise be sent to a real, internet-reachable CAD runner.",
    });
  }

  // SEC-5 — a live Stripe key (sk_live_*) must never pair with a
  // mocked CraftCloud checkout. lib/craftcloud/client.ts's
  // `USE_MOCK = process.env.CRAFTCLOUD_USE_MOCK !== "false"` defaults
  // to mock, so a prod deploy that forgets to set
  // CRAFTCLOUD_USE_MOCK=false would take real customer money via
  // Stripe while fabricating a fake craftCloudOrderId — no print
  // ever gets placed. Require the var to be explicitly "false"
  // whenever Stripe is live.
  const stripeIsLive = (env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
  const craftCloudMocked = env.CRAFTCLOUD_USE_MOCK !== "false";
  if (stripeIsLive && craftCloudMocked) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CRAFTCLOUD_USE_MOCK"],
      message:
        'CRAFTCLOUD_USE_MOCK must be set to "false" when STRIPE_SECRET_KEY is a live key (sk_live_*) — otherwise real Stripe charges are taken while CraftCloud orders are only mocked, never actually placed.',
    });
  }
});

export type ServerEnv = z.infer<typeof baseServerEnvSchema>;

/** The validated names, exported for tests / docs. */
export const REQUIRED_SERVER_ENV = Object.keys(
  baseServerEnvSchema.shape
) as (keyof ServerEnv)[];

/** Thrown when one or more required server env vars are missing/empty. */
export class EnvValidationError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Invalid server environment. Missing or empty required variable(s): ` +
        `${missing.join(", ")}. Check your .env.local (or deployment config).`
    );
    this.name = "EnvValidationError";
  }
}

let cached: ServerEnv | null = null;

/**
 * Validate the required server env. Memoized: the first successful call
 * caches the parsed result. Throws `EnvValidationError` on the first failure
 * (does not cache failures, so a retry after fixing config re-validates).
 */
export function validateServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new EnvValidationError([...new Set(missing)]);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Typed accessor for a single required server var. Validates the whole
 * schema on first use, then returns the requested, narrowed value.
 */
export function serverEnv<K extends keyof ServerEnv>(key: K): ServerEnv[K] {
  return validateServerEnv()[key];
}

export type CheckoutModel = "single" | "two_step";

/**
 * Which print-checkout architecture new orders are created under
 * (CON-118):
 *
 *  - "single"   — one Stripe Checkout charges print + shipping + 3%
 *    service fee; the webhook places the CraftCloud order after payment.
 *  - "two_step" — our Stripe Checkout only AUTHORIZES the 3% fee
 *    (manual capture), the CraftCloud order is placed up-front unpaid,
 *    the customer pays CraftCloud directly via its hosted Stripe bridge
 *    session, and a reconciliation cron captures the fee once CraftCloud
 *    payment is confirmed.
 *
 * Returns "two_step" only when CHECKOUT_MODEL is exactly that string —
 * anything else (unset, typo) falls back to "single". The env var only
 * decides the model for NEW orders; in-flight orders branch on the
 * persisted `printOrders.checkoutModel` column, never on this.
 *
 * Deliberately NOT folded into `isSandboxMode()` — two_step against the
 * real CraftCloud API is a live, billable flow, not a sandbox.
 */
export function getCheckoutModel(): CheckoutModel {
  return process.env.CHECKOUT_MODEL === "two_step" ? "two_step" : "single";
}

/**
 * True when the CAD execution sidecar is mocked — no real `CAD_RUNNER_URL`
 * configured, or `CAD_RUNNER_USE_MOCK=true` forces the mock even with a URL.
 * In mock mode the sidecar returns a hardcoded empty-mesh cube marked
 * `ok: true` for ANY prompt, persisted as a real "succeeded" build, so a
 * tester needs to know the geometry isn't real.
 *
 * Mirrors the `USE_MOCK` gate in lib/cad/runner-client.ts EXACTLY — kept
 * inline (rather than importing `isRunnerLive()`) so lib/env stays free of
 * a lib/cad dependency and the two stay in sync by construction. If you
 * change the mock condition in runner-client.ts, change it here too.
 */
export function isCadRunnerMock(): boolean {
  const runnerUrl = process.env.CAD_RUNNER_URL ?? "";
  return runnerUrl === "" || process.env.CAD_RUNNER_USE_MOCK === "true";
}

/**
 * True when EITHER Stripe is on test keys (sk_test_*) OR the CraftCloud
 * client is in mock mode OR the CAD runner is mocked. Surfaced in the nav
 * as a "Sandbox" badge so a tester walking the checkout or text-to-CAD
 * flow can tell at a glance that orders won't be billed/fulfilled for real
 * and generated geometry is a mock stand-in.
 *
 * Server-only: reads raw process.env, so don't call from a Client
 * Component. Pass the result down as a prop instead.
 *
 * House rule (AGENTS.md): every mock/test gate must be OR-ed in here so the
 * badge keeps reflecting reality.
 */
export function isSandboxMode(): boolean {
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const stripeIsTest = stripeKey.startsWith("sk_test_");
  // CRAFTCLOUD_USE_MOCK defaults to ON when unset — matches the gate
  // in lib/craftcloud/client.ts so the badge and the actual mock
  // path stay in sync.
  const craftCloudMock = process.env.CRAFTCLOUD_USE_MOCK !== "false";
  return stripeIsTest || craftCloudMock || isCadRunnerMock();
}
