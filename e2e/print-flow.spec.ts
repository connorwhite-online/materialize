import { test, expect } from "@playwright/test";

/**
 * Print quote flow smoke tests. The print pipeline is the
 * highest-touch code path in the app (per AGENTS.md, "touched
 * weekly, easy to break"), so we want a regression guard on the
 * first half of the flow — page load + file pick + transition
 * away from the empty state — independent of CraftCloud quote
 * timing.
 *
 * Playwright's webServer starts the dev server with
 * CRAFTCLOUD_USE_MOCK=true so we don't hit the real CraftCloud
 * API; the mock returns synthesized models / quotes regardless
 * of what's uploaded.
 *
 * NOTE: the mock's quote material ids don't match the live
 * CraftCloud catalog UUIDs, so the poll route drops all quotes
 * and the configurator's "happy" render doesn't appear. That's
 * acceptable for a smoke test — we want to catch crashes and
 * early-flow regressions, not assert on quote display logic
 * (which has its own vitest coverage).
 */

/**
 * Smallest legal binary STL — 80-byte header + uint32(0)
 * triangles = 84 bytes total. CraftCloud's mock doesn't
 * inspect the contents, so this is enough to exercise the
 * upload code path.
 */
function tinyStlBuffer(): Buffer {
  const buf = Buffer.alloc(84);
  buf.write("e2e-test-stl");
  buf.writeUInt32LE(0, 80);
  return buf;
}

test.describe("print flow", () => {
  test("anon /print loads with the uploader visible", async ({ page }) => {
    const response = await page.goto("/print");
    expect(response?.status()).toBe(200);

    // FileUploader headline copy — proves the uploader rendered
    // and the page didn't fall back to an error state.
    await expect(page.getByText(/Drag and drop or click to upload/i))
      .toBeVisible();

    // Format hint copy — confirms the right uploader variant
    // (not the project / asset variants which have different
    // supported-formats lists).
    await expect(
      page.getByText(/STL, OBJ, 3MF, STEP, AMF/i)
    ).toBeVisible();
  });

  test("dropping a file moves the page past the empty state", async ({
    page,
  }) => {
    await page.goto("/print");

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "e2e-test.stl",
      mimeType: "application/octet-stream",
      buffer: tinyStlBuffer(),
    });

    // The empty-state uploader copy should disappear once a
    // file is picked — the page swaps to the active layout
    // (FileContextBar + QuoteConfigurator). We don't assert on
    // quote rendering because the mock catalog mismatch means
    // those drop; we assert on the *transition* itself.
    await expect(page.getByText(/Drag and drop or click to upload/i))
      .toBeHidden({ timeout: 15_000 });
  });
});
