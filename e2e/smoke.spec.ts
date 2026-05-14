import { test, expect } from "@playwright/test";

/**
 * Read-only smoke tests for anonymous visitors. These run against
 * the dev server that playwright.config.ts spins up (with
 * `CRAFTCLOUD_USE_MOCK=true`) and don't require any DB seed data
 * or authentication — every assertion targets shape, status, or
 * headers, not specific content.
 *
 * Anything that needs an onboarded creator + paid listing belongs
 * in a separate spec (see purchase.spec.ts) since that needs DB
 * fixtures + Clerk test-mode auth.
 */

test.describe("anon smoke", () => {
  test("home renders with hero, search, and bottom bar", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // HeroShowcase mounts a <canvas> for the 3D viewport — its
    // presence proves the client component hydrated.
    await expect(page.locator("canvas").first()).toBeVisible({
      timeout: 10_000,
    });

    // HomeBottomBar exposes a Sign-in CTA for anon visitors.
    const signIn = page.getByRole("button", { name: /sign in/i });
    await expect(signIn.first()).toBeVisible();
  });

  test("/files browse page loads", async ({ page }) => {
    const response = await page.goto("/files");
    expect(response?.status()).toBeLessThan(500);
  });

  test("/materials browse page loads", async ({ page }) => {
    const response = await page.goto("/materials");
    expect(response?.status()).toBeLessThan(500);
  });

  test("unknown listing slug renders the not-found page", async ({ page }) => {
    // Next renders not-found content but currently returns 200 in
    // this app's dev config, so we assert on the body rather than
    // the status code.
    await page.goto("/files/this-slug-cannot-exist-xyz");
    await expect(page.locator("body")).toContainText(/not found|404/i);
  });
});

test.describe("response headers", () => {
  test("middleware accepts public routes without auth redirect", async ({
    page,
  }) => {
    // /materials is in the publicRoute matcher in proxy.ts. Anon
    // visit should NOT redirect to /sign-in.
    const response = await page.goto("/materials");
    expect(response?.url()).toContain("/materials");
    expect(response?.url()).not.toContain("/sign-in");
  });

  test("thumbnail route is reachable without auth", async ({ request }) => {
    // A non-existent fileId is the safest probe — we don't need a
    // seeded asset to exercise the route. The 404 path still runs
    // through middleware + Next routing, and confirms the route is
    // reachable from anon. (Cache-Control on the 302 redirect path
    // is verified by `cache-control on redirect` below.)
    const res = await request.get(
      "/api/thumbnails/00000000-0000-0000-0000-000000000000",
      { maxRedirects: 0 }
    );
    expect([302, 404]).toContain(res.status());
  });

  test("cache-control on 302 redirect (when a published file exists)", async ({
    request,
  }) => {
    // Best-effort probe: hit the catch-all thumbnail route and ride
    // the redirect chain back. If the DB has any published file
    // whose thumbnail lookup succeeds, we'll see a 302 with our
    // Cache-Control header. If there are zero published files in
    // this env, the route 404s and the test skips. Either outcome
    // is acceptable — the goal is to fail loudly only if we
    // shipped a regression in the header.
    const search = await request.get("/api/search?q=a", {
      maxRedirects: 0,
    });
    if (search.status() !== 200) {
      test.skip(true, "search endpoint not in shape we expect");
      return;
    }
    const payload = (await search.json()) as {
      files?: Array<{ id?: string }>;
    };
    const fileId = payload.files?.[0]?.id;
    if (!fileId) {
      test.skip(true, "no published files in this env to probe");
      return;
    }
    const res = await request.get(`/api/thumbnails/${fileId}`, {
      maxRedirects: 0,
    });
    if (res.status() !== 302) {
      test.skip(true, `route returned ${res.status()}; can't assert on header`);
      return;
    }
    const cc = res.headers()["cache-control"];
    expect(cc).toBeDefined();
    expect(cc).toMatch(/max-age=\d+/);
  });
});
