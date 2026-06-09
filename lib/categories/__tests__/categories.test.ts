import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  CATEGORY_IDS,
  CATEGORY_LABELS,
  getCategoryById,
  getCategoryLabel,
  isCategoryId,
  categoryIdsMatchingQuery,
} from "@/lib/categories";
import { categorySchema } from "@/lib/validations/file";

describe("category catalog", () => {
  it("has entries with unique, url-safe slugs", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("keeps CATEGORY_IDS and CATEGORY_LABELS in sync with the catalog", () => {
    expect([...CATEGORY_IDS].sort()).toEqual(
      CATEGORIES.map((c) => c.id).sort()
    );
    for (const c of CATEGORIES) {
      expect(CATEGORY_LABELS[c.id]).toBe(c.label);
    }
  });

  it("resolves known ids and rejects unknown ones", () => {
    const known = CATEGORIES[0].id;
    expect(getCategoryById(known)?.id).toBe(known);
    expect(getCategoryLabel(known)).toBe(CATEGORIES[0].label);
    expect(isCategoryId(known)).toBe(true);

    expect(getCategoryById("not-a-real-category")).toBeUndefined();
    expect(getCategoryLabel("not-a-real-category")).toBeNull();
    expect(isCategoryId("not-a-real-category")).toBe(false);
    expect(isCategoryId(null)).toBe(false);
    expect(isCategoryId(undefined)).toBe(false);
    expect(isCategoryId("")).toBe(false);
  });
});

describe("categoryIdsMatchingQuery", () => {
  it("matches on keywords, not just the label", () => {
    // "gps" only appears as a keyword on the Hobby & RC shelf.
    expect(categoryIdsMatchingQuery("gps")).toContain("hobby-rc");
    expect(categoryIdsMatchingQuery("drone")).toContain("hobby-rc");
    expect(categoryIdsMatchingQuery("ring")).toContain("jewelry");
  });

  it("matches on the label and is case-insensitive", () => {
    expect(categoryIdsMatchingQuery("toys")).toContain("toys-games");
    expect(categoryIdsMatchingQuery("TOYS")).toContain("toys-games");
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(categoryIdsMatchingQuery("")).toEqual([]);
    expect(categoryIdsMatchingQuery("   ")).toEqual([]);
  });
});

describe("categorySchema", () => {
  it("accepts a valid slug", () => {
    const id = CATEGORIES[0].id;
    expect(categorySchema.parse(id)).toBe(id);
  });

  it("treats undefined as optional", () => {
    expect(categorySchema.parse(undefined)).toBeUndefined();
  });

  it("coerces empty string and unknown slugs to undefined instead of throwing", () => {
    expect(categorySchema.parse("")).toBeUndefined();
    expect(categorySchema.parse("totally-made-up")).toBeUndefined();
  });
});
