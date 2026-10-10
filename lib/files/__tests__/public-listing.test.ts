import { describe, it, expect } from "vitest";
import { isPublicListing } from "../public-listing";

describe("isPublicListing", () => {
  it("is true for a published, public file", () => {
    expect(
      isPublicListing({ fileStatus: "published", fileVisibility: "public" })
    ).toBe(true);
  });

  it("is false for a published file the owner set private", () => {
    expect(
      isPublicListing({ fileStatus: "published", fileVisibility: "private" })
    ).toBe(false);
  });

  it("is false for a draft, whatever its visibility", () => {
    expect(
      isPublicListing({ fileStatus: "draft", fileVisibility: "public" })
    ).toBe(false);
  });

  it("is false when the left join found no file", () => {
    expect(isPublicListing({ fileStatus: null, fileVisibility: null })).toBe(
      false
    );
  });
});
