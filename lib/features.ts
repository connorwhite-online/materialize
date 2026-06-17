import "server-only";

/**
 * Feature gating for experimental, owner-only surfaces.
 *
 * Text-to-CAD ships dark: the code can be deployed to production with
 * zero user-visible effect until BOTH gates are flipped. Two independent
 * gates, AND-ed together by `canUseTextToCad`:
 *
 *   1. `TEXT_TO_CAD_ENABLED === "true"` — a fail-closed kill switch
 *      (default OFF), mirroring `isAgentBillingEnabled()` in
 *      lib/mcp/internal/orders.ts. Deploying without it is a no-op.
 *   2. `TEXT_TO_CAD_ALLOWED_EMAILS` — a comma-separated allow-list of
 *      emails. Even with the kill switch on, only listed emails reach
 *      the feature; everyone else gets a 404 and never sees the nav.
 *
 * Server-only: reads raw process.env, so don't call from a Client
 * Component — resolve on the server (page / layout / action) and thread
 * the boolean down as a prop, the way `isSandboxMode()` is threaded into
 * the nav.
 *
 * The email comes from Clerk's `currentUser()` (auth() only returns the
 * userId). `canUseTextToCad` is the single choke point: to grant/revoke
 * access without a redeploy later, swap `emailHasTextToCadAccess` to read
 * a Clerk `publicMetadata` flag — callers are unaffected.
 */

function allowedEmails(): string[] {
  return (process.env.TEXT_TO_CAD_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Kill switch. Default OFF — only `"true"` enables. */
export function isTextToCadEnabled(): boolean {
  return process.env.TEXT_TO_CAD_ENABLED === "true";
}

/** True when `email` is on the (case-insensitive) allow-list. */
export function emailHasTextToCadAccess(
  email: string | null | undefined
): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.toLowerCase());
}

/**
 * The one gate every text-to-CAD surface checks. Both the kill switch
 * AND the per-user allow-list must pass.
 */
export function canUseTextToCad(email: string | null | undefined): boolean {
  return isTextToCadEnabled() && emailHasTextToCadAccess(email);
}
