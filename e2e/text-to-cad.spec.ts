import { test, expect } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import {
  createClerkTestUser,
  deleteClerkTestUser,
  seedAppUserForClerkId,
  deleteAppUserRow,
  type ClerkTestUserFixture,
} from "./fixtures";

/**
 * Full-pipeline regression guard for the owner-gated /text-to-cad studio
 * (CON-185). `/text-to-cad` sits behind Clerk auth AND the
 * `TEXT_TO_CAD_ALLOWED_EMAILS` allow-list (lib/features.ts), so nothing else
 * in this repo exercises it — the automated PR-browser-review bot can't get
 * past the gate either, which is exactly how a silently-mocked CAD runner
 * (an empty 0-triangle STL persisted as a "successful" generation) reached
 * production undetected in June 2026.
 *
 * Uses a FIXED test email (not the randomized one `createClerkTestUser`
 * normally mints) so it can be added once to `TEXT_TO_CAD_ALLOWED_EMAILS` in
 * whatever environment runs this spec, rather than allow-listing a new
 * address every run.
 *
 * Setup this spec needs in the target environment (skips itself, loudly,
 * otherwise):
 *   - TEXT_TO_CAD_ENABLED=true
 *   - TEXT_TO_CAD_ALLOWED_EMAILS containing TEST_EMAIL below
 *
 * For the strong "this is a real, non-empty mesh" assertion, the
 * environment also needs CAD_RUNNER_URL (+ CAD_RUNNER_SECRET) pointed at a
 * live sidecar. Without it, generation still runs — through the sidecar's
 * own credential-free mock (lib/cad/runner-client.ts), which intentionally
 * returns an empty 84-byte STL — so that assertion is skipped rather than
 * failed; the test still asserts the turn completes and produces SOME
 * asset. Model calls fall back to a credential-free fake (a plain cube from
 * the prompt, lib/cad/harness.ts `localFakeModel`) whenever ANTHROPIC_API_KEY
 * / CLAUDE_CODE_OAUTH_TOKEN aren't set, so running this spec never requires
 * spending on an LLM — only the CAD_RUNNER_URL side needs to be real to get
 * the full check.
 */

const TEST_EMAIL = "e2e+clerk_test+textcad@example.com";

function textToCadGateOpen(): boolean {
  const allowed = (process.env.TEXT_TO_CAD_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return (
    process.env.TEXT_TO_CAD_ENABLED === "true" &&
    allowed.includes(TEST_EMAIL.toLowerCase())
  );
}

// A real sidecar is configured for this run — mirrors the mock condition in
// lib/cad/runner-client.ts (kept independent rather than imported: that
// module is "server-only" and not meant for a plain-Node Playwright process).
function cadRunnerLive(): boolean {
  return (
    !!process.env.CAD_RUNNER_URL && process.env.CAD_RUNNER_USE_MOCK !== "true"
  );
}

/** Binary STL: 80-byte header + uint32 triangle count (little-endian). */
function stlTriangleCount(bytes: Buffer): number {
  if (bytes.length < 84) return 0;
  return bytes.readUInt32LE(80);
}

test.describe("text-to-cad studio (full pipeline)", () => {
  let user: ClerkTestUserFixture;

  test.beforeAll(async () => {
    if (!textToCadGateOpen()) return;
    user = await createClerkTestUser(TEST_EMAIL);
    await seedAppUserForClerkId(user.userId, {
      displayName: "E2E Text-to-CAD",
    });
  });

  test.afterAll(async () => {
    if (!user) return;
    // Cascades: users -> files -> fileAssets, and users -> cad_generations
    // (all ON DELETE CASCADE on user_id, lib/db/schema.ts) — no separate
    // cad_generations/files cleanup needed. R2 bytes the generation wrote
    // (STL + render PNG) are intentionally left behind, same tradeoff
    // `createStripeOnboardedAccount` documents for its Connect accounts.
    await deleteAppUserRow(user.userId);
    await deleteClerkTestUser(user);
  });

  test("signed-in, allow-listed user generates a printable model from a prompt", async ({
    page,
  }) => {
    test.skip(
      !textToCadGateOpen(),
      `text-to-cad gate not configured for ${TEST_EMAIL} in this environment — ` +
        "set TEXT_TO_CAD_ENABLED=true and add that address to " +
        "TEXT_TO_CAD_ALLOWED_EMAILS to run this spec (see CON-185)"
    );
    // The harness is several model round-trips plus a sidecar call per
    // repair attempt (up to maxDuration=300s server-side, app/api/cad/generate
    // /route.ts) — well past Playwright's default 30s test timeout.
    test.setTimeout(240_000);

    await page.goto("/");
    await clerk.signIn({
      page,
      signInParams: { strategy: "email_code", identifier: user.email },
    });

    await page.goto("/text-to-cad");

    const composer = page.getByPlaceholder(/Describe a part/i);
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.fill("A rounded square plate with a hole through the center");
    await page.getByRole("button", { name: "Generate" }).click();

    // Poll for either a completed turn (Download link) or the destructive
    // error banner, whichever lands first — a bare "wait for Download"
    // would otherwise just time out with no clue why on a real failure.
    const errorBanner = page.locator("p.text-destructive");
    const downloadLink = page.getByRole("link", { name: /download/i });
    await expect(async () => {
      if (await errorBanner.isVisible().catch(() => false)) {
        throw new Error(
          `generation failed: ${await errorBanner.textContent()}`
        );
      }
      await expect(downloadLink).toBeVisible();
    }).toPass({ timeout: 180_000, intervals: [2_000] });

    const href = await downloadLink.getAttribute("href");
    expect(href).toBeTruthy();
    const res = await page.request.get(href!);
    expect(res.ok()).toBe(true);
    const bytes = await res.body();

    if (cadRunnerLive()) {
      // This is the exact assertion that would have caught the empty-mock
      // regression: the mock's signature is precisely 84 bytes / 0 triangles.
      expect(
        bytes.length,
        "expected real geometry (>84 bytes) — got the mock's empty-mesh " +
          "signature; check CAD_RUNNER_URL/CAD_RUNNER_SECRET on this environment"
      ).toBeGreaterThan(84);
      const triangles = stlTriangleCount(bytes);
      expect(
        triangles,
        "STL has zero triangles — an empty/degenerate mesh reached persistence"
      ).toBeGreaterThan(0);
      // Binary STL is exactly header(80) + count(4) + 50 bytes/triangle —
      // a well-formed-file sanity check, not just "some bytes came back".
      expect(bytes.length).toBe(84 + triangles * 50);
    } else {
      console.log(
        "[text-to-cad.spec] CAD_RUNNER_URL not configured for this run — " +
          "skipping the real-geometry assertion (the sidecar's credential-free " +
          "mock intentionally returns an empty mesh). Set CAD_RUNNER_URL + " +
          "CAD_RUNNER_SECRET on this environment for the full check."
      );
      expect(bytes.length).toBeGreaterThan(0);
    }
  });
});
