import { describe, expect, it } from "vitest";
import { relevanceScore } from "@/lib/discovery/relevance";

describe("relevanceScore", () => {
  it("orders the match tiers exactly", () => {
    const exact = relevanceScore("phone stand", { name: "Phone Stand" });
    const prefix = relevanceScore("phone", { name: "Phone Stand" });
    const wordStart = relevanceScore("stand", { name: "Phone Stand" });
    const buried = relevanceScore("hone", { name: "Phone Stand" });

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(buried);
    expect(buried).toBeGreaterThan(0);
  });

  it("is case- and whitespace-insensitive on an exact match", () => {
    expect(relevanceScore("  PHONE stand ", { name: "Phone Stand" })).toBe(1);
  });

  it("scores reordered multi-word queries by token coverage", () => {
    // "%stand phone%" never matches "Phone Stand v2" as a substring, so
    // without coverage this row scores 0 and sorts below every weaker
    // hit that happens to contain the literal string.
    const reordered = relevanceScore("stand phone", { name: "Phone Stand v2" });
    expect(reordered).toBeGreaterThan(0);
    expect(reordered).toBeLessThan(
      relevanceScore("phone stand", { name: "Phone Stand v2" })
    );
  });

  it("ranks a tag match below a name match", () => {
    const byName = relevanceScore("dragon", { name: "Dragon" });
    const byTag = relevanceScore("dragon", {
      name: "Articulated Toy",
      tags: ["dragon"],
    });
    expect(byName).toBeGreaterThan(byTag);
    expect(byTag).toBeGreaterThan(0);
  });

  it("treats the category bridge as the weakest evidence", () => {
    const byCategory = relevanceScore("drone", {
      name: "Camera Mount",
      matchedCategory: true,
    });
    const byTag = relevanceScore("drone", {
      name: "Camera Mount",
      tags: ["drone"],
    });
    expect(byCategory).toBeGreaterThan(0);
    expect(byTag).toBeGreaterThan(byCategory);
  });

  it("adds a corroboration bump without letting weak fields stack past a strong one", () => {
    const nameOnly = relevanceScore("dragon", { name: "Dragon" });
    const nameAndTag = relevanceScore("dragon", {
      name: "Dragon",
      tags: ["dragon"],
    });
    expect(nameAndTag).toBeGreaterThan(nameOnly);

    // Every weak field at once still loses to an exact title match.
    const allWeak = relevanceScore("dragon", {
      name: "Unrelated",
      tags: ["dragon"],
      designTags: ["dragon"],
      matchedCategory: true,
    });
    expect(allWeak).toBeLessThan(nameOnly);
  });

  it("returns 0 for an empty query or a row it cannot see a match in", () => {
    expect(relevanceScore("", { name: "Dragon" })).toBe(0);
    expect(relevanceScore("   ", { name: "Dragon" })).toBe(0);
    expect(relevanceScore("dragon", { name: "Phone Stand" })).toBe(0);
  });
});
