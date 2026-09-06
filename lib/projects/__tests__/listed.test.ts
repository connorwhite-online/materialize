import { describe, it, expect } from "vitest";
import { isProjectListedToOthers, projectHasBundledFile } from "../listed";

describe("isProjectListedToOthers", () => {
  it("is listed only when published, public, and has at least one file", () => {
    expect(
      isProjectListedToOthers({
        status: "published",
        visibility: "public",
        fileCount: 1,
      })
    ).toBe(true);
  });

  it("hides an empty public published project from other users", () => {
    expect(
      isProjectListedToOthers({
        status: "published",
        visibility: "public",
        fileCount: 0,
      })
    ).toBe(false);
  });

  it("hides private and draft projects even when they have files", () => {
    expect(
      isProjectListedToOthers({
        status: "published",
        visibility: "private",
        fileCount: 2,
      })
    ).toBe(false);
    expect(
      isProjectListedToOthers({
        status: "draft",
        visibility: "public",
        fileCount: 2,
      })
    ).toBe(false);
  });

  it("coerces a numeric string fileCount the way Neon/drizzle sometimes returns counts", () => {
    expect(
      isProjectListedToOthers({
        status: "published",
        visibility: "public",
        fileCount: "3" as unknown as number,
      })
    ).toBe(true);
  });
});

describe("projectHasBundledFile", () => {
  it("returns a drizzle SQL fragment (not a boolean)", () => {
    const frag = projectHasBundledFile();
    expect(frag).toBeTruthy();
    expect(typeof frag).toBe("object");
  });
});
