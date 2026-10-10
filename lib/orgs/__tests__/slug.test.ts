import { describe, it, expect } from "vitest";
import { slugifyOrganizationName } from "../slug";

describe("slugifyOrganizationName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyOrganizationName("Pneuma Robotics!")).toBe("pneuma-robotics");
  });
  it("folds accents rather than dropping the letter", () => {
    expect(slugifyOrganizationName("Café Ünion")).toBe("cafe-union");
  });
  it("collapses runs of punctuation and trims the ends", () => {
    expect(slugifyOrganizationName("  --A & B--  ")).toBe("a-b");
  });
  it("returns empty when nothing usable is left", () => {
    expect(slugifyOrganizationName("!!!")).toBe("");
  });
  it("caps length without leaving a trailing hyphen", () => {
    const slug = slugifyOrganizationName(`${"a".repeat(47)} b`);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });
});
