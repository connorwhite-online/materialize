import "server-only";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@clerk/nextjs/server";

/**
 * Tag the current Sentry scope with the Clerk userId. Call once at
 * the start of any server action / route handler that operates on
 * behalf of a signed-in user. The tag stays bound to the request
 * for the rest of its lifetime (Sentry's scope is per-request on
 * the Node runtime).
 *
 * Just the opaque Clerk id — no email, no name, no avatar. The
 * id alone is enough to reproduce: pair it with the request
 * context and the agent can replay against the exact buyer or
 * creator that hit the bug.
 *
 * No-op when Sentry isn't configured. No-op when the request
 * isn't authed.
 */
export async function setSentryUserFromClerk(): Promise<void> {
  try {
    const { userId } = await auth();
    if (!userId) return;
    Sentry.setUser({ id: userId });
  } catch {
    // auth() can throw in non-request contexts (e.g. during build).
    // Silently skip; we'd rather lose the tag than surface a noisy
    // exception inside an error path that itself is being reported.
  }
}
