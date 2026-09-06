import { describe, it, expect } from "vitest";
import {
  createProjectSchema,
  MAX_PROJECT_FILES,
  MAX_PROJECT_TAGS,
  MAX_TAG_LENGTH,
  MAX_PRICE_CENTS,
} from "../project";

const VALID_UUID_1 = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";

const baseInput = {
  name: "Chess Set",
  price: "0",
  license: "cc_by" as const,
  fileIds: [VALID_UUID_1],
};

describe("createProjectSchema", () => {
  it("accepts a minimal valid input", () => {
    const out = createProjectSchema.safeParse(baseInput);
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.fileIds).toEqual([VALID_UUID_1]);
      expect(out.data.price).toBe(0);
    }
  });

  it("rejects whitespace-only names after trim", () => {
    const out = createProjectSchema.safeParse({
      ...baseInput,
      name: "   ",
    });
    expect(out.success).toBe(false);
  });

  it("trims surrounding whitespace from name", () => {
    const out = createProjectSchema.safeParse({
      ...baseInput,
      name: "  My Project  ",
    });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.name).toBe("My Project");
  });

  it("dedupes duplicate fileIds", () => {
    const out = createProjectSchema.safeParse({
      ...baseInput,
      fileIds: [VALID_UUID_1, VALID_UUID_1, VALID_UUID_2],
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.fileIds).toEqual([VALID_UUID_1, VALID_UUID_2]);
    }
  });

  it(`rejects fileIds beyond MAX_PROJECT_FILES (${MAX_PROJECT_FILES})`, () => {
    // Generate MAX+1 distinct valid UUIDs (varying the last hex chars).
    const tooMany = Array.from({ length: MAX_PROJECT_FILES + 1 }, (_, i) => {
      const hex = i.toString(16).padStart(12, "0");
      return `33333333-3333-4333-8333-${hex}`;
    });
    const out = createProjectSchema.safeParse({
      ...baseInput,
      fileIds: tooMany,
    });
    expect(out.success).toBe(false);
  });

  it("dedupes + caps + lowercases tags", () => {
    // 30 raw tags with case/whitespace dups → should collapse and cap.
    const raw = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0 ? "Pla" : `tag${i}`
    ).join(", ");
    const out = createProjectSchema.safeParse({
      ...baseInput,
      tags: raw,
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.tags.length).toBeLessThanOrEqual(MAX_PROJECT_TAGS);
      const lower = out.data.tags.map((t) => t.toLowerCase());
      expect(new Set(lower).size).toBe(lower.length);
    }
  });

  it("truncates over-long individual tags to MAX_TAG_LENGTH", () => {
    const tooLong = "a".repeat(MAX_TAG_LENGTH + 50);
    const out = createProjectSchema.safeParse({
      ...baseInput,
      tags: tooLong,
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.tags[0].length).toBe(MAX_TAG_LENGTH);
    }
  });

  it("rejects price beyond the sanity ceiling", () => {
    const out = createProjectSchema.safeParse({
      ...baseInput,
      price: String(MAX_PRICE_CENTS / 100 + 1),
    });
    expect(out.success).toBe(false);
  });

  it("rejects negative price", () => {
    const out = createProjectSchema.safeParse({
      ...baseInput,
      price: "-1",
    });
    expect(out.success).toBe(false);
  });

  it("accepts an empty fileIds list so a project can be created first", () => {
    const out = createProjectSchema.safeParse({ ...baseInput, fileIds: [] });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.fileIds).toEqual([]);
  });

  it("defaults missing fileIds to an empty list", () => {
    const { fileIds: _omit, ...withoutFiles } = baseInput;
    const out = createProjectSchema.safeParse(withoutFiles);
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.fileIds).toEqual([]);
  });

  it("accepts public or private visibility", () => {
    const pub = createProjectSchema.safeParse({
      ...baseInput,
      visibility: "public",
    });
    const priv = createProjectSchema.safeParse({
      ...baseInput,
      visibility: "private",
    });
    expect(pub.success).toBe(true);
    expect(priv.success).toBe(true);
    if (pub.success) expect(pub.data.visibility).toBe("public");
    if (priv.success) expect(priv.data.visibility).toBe("private");
  });

  it("rejects non-UUID fileIds", () => {
    const out = createProjectSchema.safeParse({
      ...baseInput,
      fileIds: ["not-a-uuid"],
    });
    expect(out.success).toBe(false);
  });

  // SEC-B1 — repoUrl renders raw into href= on the public project page
  // (components/projects/source-code-card.tsx); a javascript: URI is
  // a stored-XSS primitive.
  describe("repoUrl", () => {
    it("rejects a javascript: URL", () => {
      const out = createProjectSchema.safeParse({
        ...baseInput,
        repoUrl: "javascript:alert(document.cookie)",
      });
      expect(out.success).toBe(false);
    });

    it("accepts a valid https:// repo URL", () => {
      const out = createProjectSchema.safeParse({
        ...baseInput,
        repoUrl: "https://github.com/example/repo",
      });
      expect(out.success).toBe(true);
    });

    it("accepts a valid http:// repo URL", () => {
      const out = createProjectSchema.safeParse({
        ...baseInput,
        repoUrl: "http://example.com/repo",
      });
      expect(out.success).toBe(true);
    });

    it("treats empty string repoUrl as undefined", () => {
      const out = createProjectSchema.safeParse({
        ...baseInput,
        repoUrl: "",
      });
      expect(out.success).toBe(true);
      if (out.success) expect(out.data.repoUrl).toBeUndefined();
    });
  });
});
