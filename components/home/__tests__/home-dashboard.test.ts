import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const dashboard = readFileSync(
  resolve(__dirname, "../home-dashboard.tsx"),
  "utf8"
);
const fileCard = readFileSync(
  resolve(__dirname, "../../profile/library-file-card.tsx"),
  "utf8"
);
const libraryTab = readFileSync(
  resolve(__dirname, "../../profile/library-tab.tsx"),
  "utf8"
);

describe("HomeDashboard authed create cluster", () => {
  it("no longer shows a visible Upload a file heading", () => {
    expect(dashboard).not.toMatch(/Upload a file/);
    expect(dashboard).toMatch(/sr-only">Add to your library/);
  });

  it("does not show a visible Library heading", () => {
    expect(dashboard).not.toMatch(/mb-4 text-sm font-medium">Library/);
    expect(dashboard).not.toMatch(/sr-only">Library/);
    expect(libraryTab).toMatch(/sr-only">Library/);
  });
});

describe("HomeDashboard recent files", () => {
  it("uses the same thumbnail well as library file cards", () => {
    const well =
      "rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/30";
    expect(fileCard).toContain(well);
    expect(dashboard).toContain(well);
    expect(dashboard).toContain("hover:border-primary/30");
    expect(dashboard).not.toMatch(
      /bg-muted transition-colors group-hover:border-primary\/40/
    );
  });
});

describe("authed-home library chrome", () => {
  it("hides the item-count and Add row on the compact home library", () => {
    expect(libraryTab).toMatch(/isOwner && !compact/);
  });

  it("skips the empty-state explainer on the compact home library", () => {
    expect(libraryTab).toMatch(/if \(compact\) return null/);
    expect(libraryTab).not.toMatch(/LibraryEmptyState compact/);
  });
});
