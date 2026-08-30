import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const projectPage = readFileSync(
  resolve(__dirname, "../projects/new/page.tsx"),
  "utf8"
);
const collectionPage = readFileSync(
  resolve(__dirname, "../collections/new/page.tsx"),
  "utf8"
);

describe("create pages", () => {
  it("both create screens are pages that share the icon header", () => {
    expect(projectPage).toContain("CreateFormHeader");
    expect(collectionPage).toContain("CreateFormHeader");
    expect(projectPage).toContain("LayersIcon");
    expect(collectionPage).toContain("FolderOpenIcon");
    expect(projectPage).not.toMatch(/Dialog/);
    expect(collectionPage).not.toMatch(/Dialog/);
  });
});
