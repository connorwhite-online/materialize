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
const serverEnvSchema = z.object({
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
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** The validated names, exported for tests / docs. */
export const REQUIRED_SERVER_ENV = Object.keys(
  serverEnvSchema.shape
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

/**
 * True when EITHER Stripe is on test keys (sk_test_*) OR the CraftCloud
 * client is in mock mode. Surfaced in the nav as a "Sandbox" badge so a
 * tester walking the checkout flow can tell at a glance that orders
 * won't be billed or fulfilled for real.
 *
 * Server-only: reads raw process.env, so don't call from a Client
 * Component. Pass the result down as a prop instead.
 */
export function isSandboxMode(): boolean {
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const stripeIsTest = stripeKey.startsWith("sk_test_");
  // CRAFTCLOUD_USE_MOCK defaults to ON when unset — matches the gate
  // in lib/craftcloud/client.ts so the badge and the actual mock
  // path stay in sync.
  const craftCloudMock = process.env.CRAFTCLOUD_USE_MOCK !== "false";
  return stripeIsTest || craftCloudMock;
}
