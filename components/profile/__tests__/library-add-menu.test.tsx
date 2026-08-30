import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../library-add-menu.tsx"),
  "utf8"
);

describe("LibraryAddMenu", () => {
  it("navigates Project and Collection to their create pages", () => {
    expect(source).toContain('href="/projects/new"');
    expect(source).toContain('href="/collections/new"');
    expect(source).not.toMatch(/NewCollectionDialog/);
    expect(source).not.toMatch(/collectionOpen/);
  });

  it("still gates Project on having files to bundle", () => {
    expect(source).toMatch(/canAddProject &&/);
  });
});
