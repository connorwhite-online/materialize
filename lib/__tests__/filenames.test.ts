import { describe, it, expect } from "vitest";
import { deriveListingName, buildListingSlug } from "../filenames";

describe("deriveListingName", () => {
  it("strips the extension and title-cases the stem", () => {
    expect(deriveListingName("carabiner.stl")).toBe("Carabiner");
    expect(deriveListingName("model.obj")).toBe("Model");
    expect(deriveListingName("PART.3MF")).toBe("PART");
  });

  it("converts underscores to spaces and title-cases each word", () => {
    expect(deriveListingName("left_bracket_v3.obj")).toBe("Left Bracket V3");
    expect(deriveListingName("cool_part_final.stl")).toBe("Cool Part Final");
  });

  it("converts dashes to spaces and title-cases", () => {
    expect(deriveListingName("power-drill-housing.stl")).toBe(
      "Power Drill Housing"
    );
  });

  it("collapses runs of separators", () => {
    expect(deriveListingName("foo__bar---baz.stl")).toBe("Foo Bar Baz");
  });

  it("handles filenames without an extension", () => {
    expect(deriveListingName("carabiner")).toBe("Carabiner");
  });

  it("handles multi-dot filenames by stripping only the last extension", () => {
    expect(deriveListingName("part.v2.stl")).toBe("Part.v2");
  });

  it("falls back to 'Untitled Print' for pathological filenames", () => {
    expect(deriveListingName(".stl")).toBe("Untitled Print");
    expect(deriveListingName("")).toBe("Untitled Print");
    expect(deriveListingName("___.stl")).toBe("Untitled Print");
  });
});

describe("buildListingSlug", () => {
  it("lowercases and dash-separates the name", () => {
    expect(buildListingSlug("Carabiner", "abc123")).toBe("carabiner-abc123");
    expect(buildListingSlug("Cool Part Final", "xyz999")).toBe(
      "cool-part-final-xyz999"
    );
  });

  it("strips leading and trailing dashes from the base", () => {
    expect(buildListingSlug("! Hello !", "nnn")).toBe("hello-nnn");
  });

  it("collapses runs of non-alphanumeric into single dashes", () => {
    expect(buildListingSlug("A!!!B???C", "nnn")).toBe("a-b-c-nnn");
  });

  it("appends the id suffix after a single dash", () => {
    expect(buildListingSlug("Test", "abc123")).toBe("test-abc123");
  });

  it("falls back to 'print' when the base is empty", () => {
    expect(buildListingSlug("!!!", "nnn")).toBe("print-nnn");
    expect(buildListingSlug("", "nnn")).toBe("print-nnn");
  });
});
