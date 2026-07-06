/**
 * Model-credential resolution seam for the studio (MTR-181, BYOK).
 *
 * docs/text-to-cad/08-monetization.md describes BYOK as "user key ->
 * platform key" resolution with per-request client instantiation. This module
 * is ONLY that seam — the typed resolution layer plus an env-based stub for
 * the user-key lookup. There is deliberately NO user key storage yet:
 *
 *   - Real BYOK is HARD-GATED on sidecar sandbox isolation (MTR-187 / the
 *     doc's "Hard gate" section): the sidecar executes arbitrary
 *     model-generated Python with the container as the only boundary, so no
 *     multi-user or BYOK exposure until gVisor/microVM isolation lands.
 *     MTR-169 (per-user rate caps) also lands first.
 *   - The encrypted `userModelKeys` table, key-check status, Sentry
 *     redaction, and settings copy are all part of that later issue.
 *
 * Flag matrix: `CAD_BYOK_ENABLED` (default OFF) gates the user-key branch
 * entirely. Off, `resolveModelCredentials` returns platform env credentials
 * and consumers keep their module-level singleton client — byte-identical
 * behavior. On, `CAD_BYOK_STUB_KEY` stands in for the (not yet built)
 * per-user key lookup so the seam is exercisable in tests/integration
 * without storing anything.
 *
 * BYOK covers MODEL TOKENS ONLY (per the doc): sidecar compute, fal calls,
 * and storage always run on platform credentials and still meter.
 *
 * Pure env reads, no `server-only`, so tests and the eval runner can import.
 */

export type ModelCredentialSource = "platform" | "user";

/** Resolved credentials for one generation's model calls. */
export interface ResolvedModelCredentials {
  source: ModelCredentialSource;
  /** Anthropic API key (the intended BYOK shape — API keys only, no OAuth). */
  apiKey?: string;
  /** Platform-only fallback: CLAUDE_CODE_OAUTH_TOKEN bearer auth. */
  authToken?: string;
}

/** BYOK kill switch — default OFF; nothing user-key-shaped runs without it. */
export function byokEnabled(): boolean {
  return process.env.CAD_BYOK_ENABLED === "true";
}

/** Platform (env) credentials — exactly what model-client resolves today. */
export function platformModelCredentials(): ResolvedModelCredentials {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) return { source: "platform", apiKey };
  return {
    source: "platform",
    authToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
  };
}

/**
 * The (stubbed) per-user key lookup. Real implementation is blocked on
 * MTR-187 sandbox isolation + the encrypted `userModelKeys` table; until
 * then `CAD_BYOK_STUB_KEY` lets the user-key path be exercised end-to-end
 * without persisting key material anywhere.
 */
async function lookupUserModelKey(_userId: string): Promise<string | null> {
  return process.env.CAD_BYOK_STUB_KEY || null;
}

/**
 * Resolve the credentials a generation should run under: the user's own key
 * when BYOK is enabled and one exists, the platform key otherwise. Never
 * throws — any lookup failure falls back to platform credentials, matching
 * the doc's "user key -> platform key" contract.
 */
export async function resolveModelCredentials(
  userId?: string | null
): Promise<ResolvedModelCredentials> {
  if (byokEnabled() && userId) {
    try {
      const key = await lookupUserModelKey(userId);
      if (key) return { source: "user", apiKey: key };
    } catch {
      // Fall through to platform credentials — BYOK must never break a build.
    }
  }
  return platformModelCredentials();
}
