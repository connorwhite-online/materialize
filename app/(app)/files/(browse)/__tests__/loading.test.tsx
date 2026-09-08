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
  it("mirrors the idle browse chrome: search, category select, sections, FileCard body", () => {
    const { container } = render(<FilesLoading />);

    // Centered search bar — BrowseSearchBar is max-w-2xl rounded-3xl ~46px.
    const search = container.querySelector(".max-w-2xl.rounded-3xl");
    expect(search).toBeTruthy();
    expect(search?.className).toContain("h-[46px]");

    // CategoryFilterBar Select trigger — size sm → h-9, min-w-48.
    expect(container.querySelector(".h-9.w-48")).toBeTruthy();

    // Two section headers (Projects + Files), not a flat untitled grid.
    expect(container.querySelectorAll("section.mt-10")).toHaveLength(2);

    const cards = container.querySelectorAll(`[data-slot="card"]`);
    expect(cards.length).toBeGreaterThanOrEqual(10);

    for (const card of cards) {
      // Shared FileCard shell: gap-0 p-1 (overrides Card's default py-4/gap-4).
      expect(card.className).toMatch(/\bgap-0\b/);
      expect(card.className).toMatch(/\bp-1\b/);

      // Well is a real inset square container wrapping the pulse fill.
      const well = card.querySelector("[class*='aspect-square']");
      expect(well).toBeTruthy();
      expect(well?.className).toContain("rounded-lg");
      for (const token of FILE_CARD_WELL_CLASS.split(/\s+/)) {
        if (token.startsWith("bg-") || token.startsWith("from-") || token.startsWith("to-")) {
          continue;
        }
        expect(well?.className.split(/\s+/)).toContain(token);
      }

      const body = card.querySelector(`[data-slot="card-content"]`);
      expect(body?.className.split(/\s+/)).toContain(FILE_CARD_BODY_CLASS);

      // Creator row: 14px avatar circle (not a price/downloads justify-between).
      const avatar = body?.querySelector(".rounded-full");
      expect(avatar).toBeTruthy();
      expect(avatar?.className).toMatch(/\bh-3\.5\b/);
      expect(avatar?.className).toMatch(/\bw-3\.5\b/);
      expect(body?.querySelector(".justify-between")).toBeNull();
    }
  });
});
