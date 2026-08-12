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

    // The hero is now static server-rendered markup — no canvas. This
    // used to assert on HeroShowcase's <canvas> as a hydration proof;
    // that mount is gone (see the visual slot in app/page.tsx), so the
    // heading is what proves the hero rendered, and the Sign-in CTA
    // below proves the client bundle hydrated.
    await expect(
      page.getByRole("heading", { level: 1, name: /print in any material/i })
    ).toBeVisible();

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
    // seeded asset to exercise the route. A valid-format id that backs
    // no row now returns a 200 transparent-PNG placeholder (issue #63)
    // rather than 404, so browse cards never emit a same-origin
    // network failure for a stale preview-seed reference. 302 is still
    // accepted for older redirect-style responses.
    const res = await request.get(
      "/api/thumbnails/00000000-0000-0000-0000-000000000000",
      { maxRedirects: 0 }
    );
    expect([200, 302, 404]).toContain(res.status());
  });

  test("thumbnail route returns 404 for a malformed fileId, not a DB error (sentry 7484237159)", async ({
    request,
  }) => {
    // Regression: a truncated/non-UUID fileId (e.g. "ba14f9ed-106b-46e3-8")
    // used to be forwarded straight to Postgres, which threw
    // "invalid input syntax for type uuid" — caught by the route's
    // try-catch and surfaced as a 500 + Sentry event 7484237159.
    // After the fix, the route validates the format before touching the
    // DB and returns 404 cleanly.
    const res = await request.get(
      "/api/thumbnails/ba14f9ed-106b-46e3-8",
      { maxRedirects: 0 }
    );
    expect(res.status()).not.toBe(500);
    expect([400, 404]).toContain(res.status());
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
