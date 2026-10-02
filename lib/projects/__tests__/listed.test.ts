import { describe, it, expect } from "vitest";
import { isProjectListedToOthers } from "../listed";

describe("isProjectListedToOthers", () => {
  it("lists a published public project with files", () => {
    expect(
      isProjectListedToOthers({
        status: "published",
        visibility: "public",
        fileCount: 1,
      })
    ).toBe(true);
  });

  it("lists a published public project with no files", () => {
    expect(
      isProjectListedToOthers({
        status: "published",
        visibility: "public",
        fileCount: 0,
      })
    ).toBe(true);
    expect(
      isProjectListedToOthers({ status: "published", visibility: "public" })
    ).toBe(true);
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
});
