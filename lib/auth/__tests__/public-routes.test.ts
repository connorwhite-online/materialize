import { describe, expect, it, vi } from "vitest";

// vitest.setup.ts pre-mocks @clerk/nextjs/server for the app's tests.
// This file needs the real `createRouteMatcher` — the point is to check
// the patterns against Clerk's own matching, not a reimplementation of it.
vi.mock("@clerk/nextjs/server", async (importOriginal) =>
  importOriginal<typeof import("@clerk/nextjs/server")>()
);

import { createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { PUBLIC_ROUTES } from "@/lib/auth/public-routes";

const isPublic = createRouteMatcher([...PUBLIC_ROUTES]);
const at = (path: string) => isPublic(new NextRequest(`https://mtrl.test${path}`));

describe("PUBLIC_ROUTES — owner-gated surfaces", () => {
  /**
   * These pages run their own gate and notFound() for anyone who fails
   * it. They must be public at the proxy layer to get that far: if
   * auth.protect() sees them first, an anonymous visitor is redirected
   * to sign-in, which discloses that the route exists.
   *
   * This is the regression that shipped once already — the list said
   * `/text-to-cad(.*)` after the route was renamed to `/prometheus`,
   * so the single-segment vanity-profile pattern kept `/prometheus`
   * public by accident while every sub-route fell through.
   */
  it.each([
    "/prometheus",
    "/prometheus/eval",
    "/prometheus/exemplars",
    "/internal",
    "/internal/discovery",
    "/sandbox/fee-sheet",
    "/sandbox/checkout-sheet",
  ])("%s reaches its own gate", (path) => {
    expect(at(path)).toBe(true);
  });

  it("names no route that no longer exists", () => {
    // `/text-to-cad` was renamed to `/prometheus`; the entry outlived
    // the route by several months.
    expect(PUBLIC_ROUTES).not.toContain("/text-to-cad(.*)");
    expect(at("/text-to-cad/eval")).toBe(false);
  });
});

describe("PUBLIC_ROUTES — genuinely public surfaces", () => {
  it.each([
    "/",
    "/files",
    "/files/some-slug",
    "/materials/pla-white",
    "/api/search?q=x",
    "/api/webhooks/stripe",
    "/api/cron/place-auto-approved-orders",
    "/llms.txt",
    "/sitemap.xml",
    "/somehandle",
    "/orders/abc-123/pay-production",
  ])("%s stays reachable without a session", (path) => {
    expect(at(path)).toBe(true);
  });
});

describe("PUBLIC_ROUTES — authed surfaces stay gated", () => {
  it.each([
    "/dashboard",
    "/dashboard/orders/abc",
    "/checkout",
    "/onboarding",
    "/orders/abc-123/confirm",
    "/orders/abc-123/cancel",
  ])("%s still hits auth.protect()", (path) => {
    expect(at(path)).toBe(false);
  });

  /**
   * The vanity-profile pattern matches ANY single root segment that
   * isn't on its exclusion list, so a one-segment authed route is
   * proxy-public whether or not anyone intended it. `/notifications`
   * is the live example: it is reachable at this layer and gates
   * itself (`if (!userId) redirect("/")`), which is correct — but it
   * means a new single-segment route CANNOT rely on auth.protect() and
   * must carry its own check. Pinned because it reads like an
   * oversight and is load-bearing.
   */
  it("leaves single-segment routes to gate themselves", () => {
    expect(at("/notifications")).toBe(true);
  });
});
