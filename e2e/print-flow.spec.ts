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
 * Quote display is covered by vitest on the picker. This file
 * only asserts the early-flow transition (uploader → configurator).
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

/**
 * Regression test for Sentry event 7483761588: "Error: aborted"
 *
 * Root cause: Node.js fires Error('aborted') from node:_http_server →
 * abortIncoming when the client disconnects mid-request (navigation away,
 * tab close, network drop). The Next.js onRequestError hook previously
 * forwarded every such error to Sentry, creating noise for an event that
 * is routine browser behaviour with no in-app stack frames.
 *
 * Reproduction strategy: when the browser aborts an in-flight fetch to
 * a server action (here: by navigating away while the upload is pending),
 * Next.js invokes onRequestError with Error('aborted'). After the fix the
 * handler returns early for that error family so Sentry stays clean. The
 * most observable symptom on the client side is that navigating away and
 * back must not leave the page in a broken state — we assert exactly that.
 */
test.describe("abort-handling regression (Sentry 7483761588)", () => {
  test("navigating away mid-upload does not crash the print page on return", async ({
    page,
  }) => {
    await page.goto("/print");

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "abort-test.stl",
      mimeType: "application/octet-stream",
      buffer: tinyStlBuffer(),
    });

    // The uploader transitions away from the empty state — proving the
    // file was accepted and an upload/quote was initiated server-side.
    // Navigate away immediately to abort the in-flight request; this is
    // the event sequence that triggers node:_http_server abortIncoming.
    await expect(page.getByText("Add a File")).toBeHidden({
      timeout: 15_000,
    });
    await page.goto("/");

    // Return to the print page: it must still serve 200 and render the
    // uploader — not an error page or an empty blank.
    const response = await page.goto("/print");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Add a File")).toBeVisible();
  });

  test("no unhandled error console message on rapid navigation away from print", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/print");
    // Navigate away immediately — the server action for the initial page
    // render is still settling; this creates the abort condition.
    await page.goto("/");

    // Allow any async server-side cleanup to flush.
    await page.waitForTimeout(500);

    // No client-side console error should have fired as a result of the
    // abort — the error is server-side only and should be suppressed, not
    // forwarded to the browser as an unhandled error.
    const abortErrors = consoleErrors.filter((m) =>
      m.toLowerCase().includes("aborted")
    );
    expect(abortErrors).toHaveLength(0);
  });
});

test.describe("print flow", () => {
  test("anon /print loads with the uploader visible", async ({ page }) => {
    const response = await page.goto("/print");
    expect(response?.status()).toBe(200);

    // Featured FileUploader — same Add a File well as authed home.
    await expect(page.getByText("Add a File")).toBeVisible();
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
    await expect(page.getByText("Add a File")).toBeHidden({
      timeout: 15_000,
    });
  });
});
