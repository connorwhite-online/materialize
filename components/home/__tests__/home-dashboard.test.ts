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

describe("HomeDashboard recent files", () => {
  it("no longer shows a visible Upload a file heading", () => {
    expect(dashboard).not.toMatch(/Upload a file/);
  });

  it("uses the same thumbnail well as library file cards", () => {
    const well =
      "rounded-lg border border-border bg-gradient-to-br from-muted/60 to-muted/30";
    expect(fileCard).toContain(well);
    expect(dashboard).toContain(well);
    expect(dashboard).toContain("hover:border-primary/30");
    expect(dashboard).not.toMatch(/bg-muted transition-colors group-hover:border-primary\/40/);
  });
});
