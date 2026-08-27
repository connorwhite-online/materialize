import "server-only";

import { currentUser } from "@clerk/nextjs/server";
import { primaryEmail, type ClerkUserLike } from "@/lib/clerk-email";

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

/**
 * Resolve whether the current request's user may see the text-to-CAD
 * surfaces, safe to call from a layout/page that renders on every route.
 *
 * `currentUser()` makes a Clerk Backend API call and, like `auth()`,
 * throws "auth() was called but Clerk can't detect usage of
 * clerkMiddleware()" when the Clerk proxy context isn't wired up for a
 * request (Sentry 7488668107 — same failure mode guarded in
 * `getMyUnreadNotificationCount`). It only does real work for signed-in
 * users, so an unguarded throw here 500s every authed page under
 * `app/(app)/layout.tsx`. We fail closed: any throw → no access, which
 * is the correct default for an owner-only experimental gate. The
 * env kill switch is checked first so the default-off deployment never
 * makes the backend call at all.
 */
export async function resolveTextToCadAccess(): Promise<boolean> {
  if (!isTextToCadEnabled()) return false;
  try {
    const user = (await currentUser()) as ClerkUserLike;
    return canUseTextToCad(primaryEmail(user));
  } catch {
    // currentUser() can throw when the Clerk proxy context is absent.
    // Fail closed rather than crash the layout.
    return false;
  }
}

/**
 * Internal tools — the owner-only operator surfaces under `/internal`.
 *
 * Same fail-closed shape as the text-to-CAD gate above (kill switch
 * AND an allow-list), with one addition: a Clerk `publicMetadata`
 * flag is honoured alongside the env allow-list, so access can be
 * granted or revoked from the Clerk dashboard without a redeploy.
 * `publicMetadata` rides along on the `currentUser()` call the email
 * already requires, so it costs no extra request.
 *
 * Deliberately separate from `canUseTextToCad` rather than reusing it:
 * "can use the CAD studio" and "can read operator dashboards" are
 * different grants that will diverge the first time someone needs one
 * without the other, and collapsing them now makes that separation a
 * migration instead of an edit.
 */
export function isInternalToolsEnabled(): boolean {
  return process.env.INTERNAL_TOOLS_ENABLED === "true";
}

function internalAllowedEmails(): string[] {
  return (process.env.INTERNAL_TOOLS_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Clerk `publicMetadata.internal === true`. Strict equality on the
 * boolean, not truthiness: `publicMetadata` is operator-editable free
 * JSON, and a stray `"false"` string is truthy.
 */
export function hasInternalMetadataFlag(user: ClerkUserLike | null): boolean {
  const metadata = (user as { publicMetadata?: Record<string, unknown> } | null)
    ?.publicMetadata;
  return metadata?.internal === true;
}

/**
 * The single choke point for every internal surface.
 *
 * Next's own auth guidance is that layouts are the wrong place for
 * this — they don't re-render on navigation, so the session isn't
 * re-checked on a route change, and they don't cover nested segments,
 * route handlers or server actions. So every internal entry point
 * calls this itself, and this function is the thing to change when the
 * grant mechanism changes.
 */
export async function resolveInternalToolsAccess(): Promise<boolean> {
  if (!isInternalToolsEnabled()) return false;
  try {
    const user = (await currentUser()) as ClerkUserLike;
    if (!user) return false;
    return (
      internalAllowedEmails().includes((primaryEmail(user) ?? "").toLowerCase())
      || hasInternalMetadataFlag(user)
    );
  } catch {
    // currentUser() throws when the Clerk proxy context is absent —
    // fail closed, same as resolveTextToCadAccess.
    return false;
  }
}
