// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import FilesLoading from "../loading";
import {
  FILE_CARD_BODY_CLASS,
  FILE_CARD_WELL_CLASS,
} from "@/components/files/file-card";

/**
 * Pins the /files loading skeleton to the idle browse layout so a
 * future page redesign can't leave a stale title/search + price-row
 * placeholder behind again (CON-37).
 */
describe("FilesLoading", () => {
  it("mirrors the idle browse chrome: search, category chips, sections, FileCard body", () => {
    const { container } = render(<FilesLoading />);

    // Search field — BrowseSearchBar is a max-w-xl 40px pill.
    const search = container.querySelector(".max-w-xl.rounded-full");
    expect(search).toBeTruthy();
    expect(search?.className).toContain("h-10");

    // CategoryFilterBar chip row — 32px pills.
    expect(container.querySelectorAll(".h-8.rounded-full").length).toBeGreaterThan(3);

    // Two section headers (Files + Projects), not a flat untitled grid.
    expect(container.querySelectorAll("section")).toHaveLength(2);

    const cards = container.querySelectorAll(`[data-slot="card"]`);
    expect(cards.length).toBeGreaterThanOrEqual(10);

    for (const card of cards) {
      // Shared FileCard shell: gap-0 p-0 (overrides Card's default py-4/gap-4).
      expect(card.className).toMatch(/\bgap-0\b/);
      expect(card.className).toMatch(/\bp-0\b/);

      // Well is a real inset square container wrapping the pulse fill.
      const well = card.querySelector("[class*='aspect-square']");
      expect(well).toBeTruthy();
      expect(well?.className).toContain("rounded-xl");
      for (const token of FILE_CARD_WELL_CLASS.split(/\s+/)) {
        if (token.startsWith("bg-") || token.startsWith("ring") || token.startsWith("transition") || token.startsWith("duration")) {
          continue;
        }
        expect(well?.className.split(/\s+/)).toContain(token);
      }

      const body = card.querySelector(`[data-slot="card-content"]`);
      for (const token of FILE_CARD_BODY_CLASS.split(/\s+/)) {
        expect(body?.className.split(/\s+/)).toContain(token);
      }

      // Creator row: 14px avatar circle (not a price/downloads justify-between).
      const avatar = body?.querySelector(".rounded-full");
      expect(avatar).toBeTruthy();
      expect(avatar?.className).toMatch(/\bh-3\.5\b/);
      expect(avatar?.className).toMatch(/\bw-3\.5\b/);
      expect(body?.querySelector(".justify-between")).toBeNull();
    }
  });
});
