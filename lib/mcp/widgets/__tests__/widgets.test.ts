import { describe, it, expect, beforeEach } from "vitest";
import { mintWidgetModelToken, verifyWidgetModelToken } from "../model-token";
import { quoteWidgetHtml } from "../quote-widget";
import { materialsWidgetHtml } from "../materials-widget";
import { toCm3 } from "@/lib/mcp/internal/quotes";

describe("widget model token", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_widget";
  });

  it("verifies for its own asset until it expires", () => {
    const now = Date.UTC(2026, 9, 9);
    const t = mintWidgetModelToken("asset-a", now);
    expect(verifyWidgetModelToken("asset-a", t, now + 1000)).toBe(true);
    expect(verifyWidgetModelToken("asset-b", t, now + 1000)).toBe(false);
    expect(verifyWidgetModelToken("asset-a", t, now + 25 * 3600 * 1000)).toBe(false);
    expect(verifyWidgetModelToken("asset-a", null, now)).toBe(false);
    expect(verifyWidgetModelToken("asset-a", "garbage", now)).toBe(false);
  });
});

describe("widget templates", () => {
  it.each([
    ["quote", quoteWidgetHtml],
    ["materials", materialsWidgetHtml],
  ])("%s is a complete document with no unfilled template holes", (_n, html) => {
    const doc = html();
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    // The widget scripts are written without template literals; a stray
    // `${` would mean an interpolation leaked into the page.
    expect(doc).not.toContain("${");
    expect(doc).toContain('"three":"https://cdn.jsdelivr.net/npm/three@');
  });
});

describe("toCm3", () => {
  it("reads CraftCloud's mm³ and keeps values already in cm³", () => {
    const cube = { x: 20, y: 20, z: 20 };
    expect(toCm3(8000, cube)).toBe(8);
    expect(toCm3(8, cube)).toBe(8);
    expect(toCm3(undefined, cube)).toBeNull();
    expect(toCm3(0, cube)).toBeNull();
  });
});
