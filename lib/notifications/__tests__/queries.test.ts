import { describe, it, expect, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

// db is used by getMyUnreadNotificationCount; mock it so the test
// is fully isolated from the database.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ value: 3 }]),
      }),
    }),
  },
}));

// Import AFTER mocks are in place.
const { getMyUnreadNotificationCount } = await import("../queries");

/**
 * Regression test for Sentry 7488668107.
 *
 * In Next.js 16 + Clerk v7, `auth()` throws
 *   "Clerk: auth() was called but Clerk can't detect usage of
 *    clerkMiddleware()"
 * when the Clerk proxy context is not set up for the request.
 * This can happen on GET /[handle] in certain edge scenarios
 * (e.g. requests that bypass the proxy matcher, bot traffic, or
 * race conditions during streaming SSR).
 *
 * `getMyUnreadNotificationCount` is called unconditionally from
 * `app/(app)/layout.tsx` on every route under (app).  Its own
 * docstring already says it should return 0 "for anon viewers
 * and on transient failure" — but the auth() call was not
 * wrapped in a try/catch, so the error propagated and crashed
 * the layout with a 500.
 */
describe("getMyUnreadNotificationCount", () => {
  it("returns 0 when auth() throws the Clerk middleware-context error (Sentry 7488668107)", async () => {
    vi.mocked(auth).mockRejectedValueOnce(
      new Error(
        "Clerk: auth() was called but Clerk can't detect usage of clerkMiddleware(). " +
          "Please ensure the following:\n" +
          "- Your middleware or proxy file exists at ./middleware.(ts|js) or proxy.(ts|js)\n" +
          "- clerkMiddleware() is used in your Next.js middleware or proxy file."
      )
    );

    const count = await getMyUnreadNotificationCount();
    expect(count).toBe(0);
  });

  it("returns 0 for anonymous users (userId null)", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as Awaited<
      ReturnType<typeof auth>
    >);

    const count = await getMyUnreadNotificationCount();
    expect(count).toBe(0);
  });

  it("returns the unread count for an authenticated user", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_123" } as Awaited<
      ReturnType<typeof auth>
    >);
    // db mock above returns [{ value: 3 }]

    const count = await getMyUnreadNotificationCount();
    expect(count).toBe(3);
  });

  it("returns 0 when the DB query swallows a transient error", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: "user_123" } as Awaited<
      ReturnType<typeof auth>
    >);
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("fetch failed")),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const count = await getMyUnreadNotificationCount();
    expect(count).toBe(0);
  });
});
