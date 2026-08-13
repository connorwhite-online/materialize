import "server-only";

import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { eq, and, isNull, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { swallow } from "@/lib/utils/swallow";

/**
 * Initial unread-notification count for the currently authed user.
 * Returns 0 for anon viewers and on transient failure — both
 * indistinguishable from "no unread" in the UI, which is fine for a
 * passive dot indicator. The SSE stream is the source of truth once
 * the page has hydrated.
 *
 * auth() is wrapped in try/catch because in Next.js 16 + Clerk v7 the
 * function throws "auth() was called but Clerk can't detect usage of
 * clerkMiddleware()" when the proxy context is not wired up for a
 * request (Sentry 7488668107). Callers such as app/(app)/layout.tsx
 * invoke this on every route — a crash here 500s the entire page.
 * The documented intent ("returns 0 … on transient failure") already
 * covers this case; the try/catch enforces it.
 *
 * Wrapped in React.cache so multiple callers within the same request
 * (app/(app)/layout.tsx and the authed branch of app/page.tsx)
 * share a single DB round trip instead of each re-querying.
 */
export const getMyUnreadNotificationCount = cache(
  async function getMyUnreadNotificationCount(): Promise<number> {
    let userId: string | null;
    try {
      ({ userId } = await auth());
    } catch {
      // auth() can throw when the Clerk proxy context is absent.
      // Treat as anonymous — no unread count available.
      return 0;
    }
    if (!userId) return 0;

    const rows = await swallow(
      db
        .select({ value: count() })
        .from(notifications)
        .where(
          and(eq(notifications.userId, userId), isNull(notifications.readAt))
        )
    );
    return rows[0]?.value ?? 0;
  }
);
