// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import FileDetailLoading from "../loading";

/**
 * Pins the file-page skeleton to the listing layout in
 * app/(app)/files/[slug]/page.tsx so it cannot drift back into a
 * browse-grid placeholder (CON-37).
 */
describe("FileDetailLoading", () => {
  it("mirrors the file page: 4:3 preview, creator row, xl actions, photos", () => {
    const { container } = render(<FileDetailLoading />);

    expect(container.querySelector(".max-w-4xl")).toBeTruthy();
    expect(container.querySelector(".max-w-7xl")).toBeNull();

    const preview = container.querySelector(".aspect-\\[4\\/3\\]");
    expect(preview).toBeTruthy();
    expect(preview?.className).toContain("rounded-2xl");
    expect(preview?.className).toContain("border");

    // Stacked on mobile, 3fr/2fr on md — same as the live page.
    const hero = container.querySelector(".md\\:grid-cols-\\[3fr_2fr\\]");
    expect(hero).toBeTruthy();

    // Creator: 20px avatar circle (UserAvatar h-5), not a card tile.
    const avatar = container.querySelector(".h-5.w-5.rounded-full");
    expect(avatar).toBeTruthy();

    // Download + Print are size xl (h-12), side by side.
    const xlActions = container.querySelectorAll(".h-12.flex-1");
    expect(xlActions.length).toBe(2);

    // Photo row uses PhotosFeed thumb size (w-32 / sm:w-40).
    const thumbs = container.querySelectorAll(".aspect-square.w-32");
    expect(thumbs.length).toBe(4);

    // Activity card (always on the live page).
    expect(container.querySelector(".bg-muted\\/50")).toBeTruthy();
    expect(container.querySelectorAll(".h-6.w-6.rounded-full").length).toBe(3);

    // Must not look like the browse grid.
    expect(container.querySelector(".grid-cols-2")).toBeNull();
    expect(container.querySelector("[data-slot='file-card']")).toBeNull();
    expect(container.querySelector(".max-w-2xl.rounded-3xl")).toBeNull();
  });
});
