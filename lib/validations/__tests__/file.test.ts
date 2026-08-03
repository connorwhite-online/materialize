import { describe, it, expect } from "vitest";
import {
  fileExtensionToFormat,
  createListingSchema,
  profileSchema,
  socialLinksSchema,
  ACCEPTED_FORMATS,
  MAX_FILE_SIZE,
  MAX_PRICE_CENTS,
} from "../file";

describe("fileExtensionToFormat", () => {
  it("returns correct format for standard extensions", () => {
    expect(fileExtensionToFormat("model.stl")).toBe("stl");
    expect(fileExtensionToFormat("model.obj")).toBe("obj");
    expect(fileExtensionToFormat("model.3mf")).toBe("3mf");
    expect(fileExtensionToFormat("model.step")).toBe("step");
    expect(fileExtensionToFormat("model.amf")).toBe("amf");
  });

  it("maps .stp to step", () => {
    expect(fileExtensionToFormat("model.stp")).toBe("step");
  });

  it("is case-insensitive", () => {
    expect(fileExtensionToFormat("model.STL")).toBe("stl");
    expect(fileExtensionToFormat("model.OBJ")).toBe("obj");
  });

  it("returns null for unsupported extensions", () => {
    expect(fileExtensionToFormat("model.fbx")).toBeNull();
    expect(fileExtensionToFormat("model.gltf")).toBeNull();
    expect(fileExtensionToFormat("image.png")).toBeNull();
  });

  it("returns null for files without extension", () => {
    expect(fileExtensionToFormat("noextension")).toBeNull();
  });

  it("handles dots in filename", () => {
    expect(fileExtensionToFormat("my.model.v2.stl")).toBe("stl");
  });
});

describe("ACCEPTED_FORMATS", () => {
  it("contains expected formats", () => {
    expect(ACCEPTED_FORMATS).toContain("stl");
    expect(ACCEPTED_FORMATS).toContain("obj");
    expect(ACCEPTED_FORMATS).toContain("3mf");
    expect(ACCEPTED_FORMATS).toContain("step");
    expect(ACCEPTED_FORMATS).toContain("amf");
    expect(ACCEPTED_FORMATS).toHaveLength(5);
  });
});

describe("MAX_FILE_SIZE", () => {
  it("is 200MB in bytes", () => {
    expect(MAX_FILE_SIZE).toBe(200 * 1024 * 1024);
  });
});

describe("createListingSchema", () => {
  const validData = {
    name: "Test Model",
    description: "A great model",
    price: "9.99",
    license: "cc_by",
    tags: "tag1, tag2, tag3",
  };

  it("parses valid data", () => {
    const result = createListingSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Test Model");
      expect(result.data.price).toBe(999); // dollars to cents
      expect(result.data.license).toBe("cc_by");
      expect(result.data.tags).toEqual(["tag1", "tag2", "tag3"]);
    }
  });

  it("converts price from dollars to cents", () => {
    const result = createListingSchema.safeParse({ ...validData, price: "25" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(2500);
    }
  });

  it("accepts price of 0 (free)", () => {
    const result = createListingSchema.safeParse({ ...validData, price: "0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(0);
    }
  });

  it("rejects negative price", () => {
    const result = createListingSchema.safeParse({ ...validData, price: "-1" });
    expect(result.success).toBe(false);
  });

  // MTR-139: createListingSchema.price had .min(0) but no .max(), while
  // the otherwise-identical project schema caps at MAX_PRICE_CENTS
  // ($1M) — a typo (extra zero) or scripted caller could otherwise push
  // a file price toward the int32 ceiling.
  it("accepts a price right at the cap", () => {
    const result = createListingSchema.safeParse({
      ...validData,
      price: String(MAX_PRICE_CENTS / 100),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price).toBe(MAX_PRICE_CENTS);
    }
  });

  it("rejects a price above the cap", () => {
    const result = createListingSchema.safeParse({
      ...validData,
      price: String(MAX_PRICE_CENTS / 100 + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a price near the int32 cents ceiling (e.g. a typo'd extra zero)", () => {
    const result = createListingSchema.safeParse({
      ...validData,
      price: "99999999", // ~$21M in cents once converted — the old unbounded ceiling
    });
    expect(result.success).toBe(false);
  });

  it("requires name", () => {
    const result = createListingSchema.safeParse({ ...validData, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name over 200 chars", () => {
    const result = createListingSchema.safeParse({
      ...validData,
      name: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("rejects description over 5000 chars", () => {
    const result = createListingSchema.safeParse({
      ...validData,
      description: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid license", () => {
    const result = createListingSchema.safeParse({
      ...validData,
      license: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid licenses", () => {
    for (const license of [
      "cc0",
      "cc_by",
      "cc_by_sa",
      "cc_by_nd",
      "cc_by_nc",
      "cc_by_nc_sa",
      "cc_by_nc_nd",
      "mit",
      "gpl_v3",
    ]) {
      const result = createListingSchema.safeParse({ ...validData, license });
      expect(result.success).toBe(true);
    }
  });

  it("rejects legacy license values now that the enum is CC-only", () => {
    for (const license of ["free", "personal", "commercial"]) {
      const result = createListingSchema.safeParse({ ...validData, license });
      expect(result.success).toBe(false);
    }
  });

  it("handles empty tags", () => {
    const result = createListingSchema.safeParse({ ...validData, tags: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it("handles missing tags", () => {
    const { tags, ...noTags } = validData;
    const result = createListingSchema.safeParse(noTags);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual([]);
    }
  });

  it("trims and filters tags", () => {
    const result = createListingSchema.safeParse({
      ...validData,
      tags: " tag1 , , tag2 , ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tags).toEqual(["tag1", "tag2"]);
    }
  });
});

describe("profileSchema", () => {
  it("accepts valid profile", () => {
    const result = profileSchema.safeParse({
      username: "testuser",
      displayName: "Test User",
      bio: "Hello world",
    });
    expect(result.success).toBe(true);
  });

  it("rejects username under 3 chars", () => {
    const result = profileSchema.safeParse({ username: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects username over 30 chars", () => {
    const result = profileSchema.safeParse({ username: "a".repeat(31) });
    expect(result.success).toBe(false);
  });

  it("rejects username with special chars", () => {
    const result = profileSchema.safeParse({ username: "test user!" });
    expect(result.success).toBe(false);
  });

  it("accepts underscores and hyphens in username", () => {
    const result = profileSchema.safeParse({ username: "test_user-1" });
    expect(result.success).toBe(true);
  });

  it("rejects bio over 500 chars", () => {
    const result = profileSchema.safeParse({
      username: "testuser",
      bio: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});

describe("socialLinksSchema", () => {
  it("accepts valid social links", () => {
    const result = socialLinksSchema.safeParse([
      { platform: "twitter", url: "https://twitter.com/test" },
      { platform: "github", url: "https://github.com/test" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL", () => {
    const result = socialLinksSchema.safeParse([
      { platform: "twitter", url: "not-a-url" },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects more than 6 links", () => {
    const links = Array.from({ length: 7 }, (_, i) => ({
      platform: `platform${i}`,
      url: `https://example.com/${i}`,
    }));
    const result = socialLinksSchema.safeParse(links);
    expect(result.success).toBe(false);
  });

  it("accepts empty array", () => {
    const result = socialLinksSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  // SEC-B1 — socialLinkSchema.url rendered raw into href= on the
  // public profile page; a javascript: URI is a stored-XSS primitive.
  it("rejects a javascript: URL", () => {
    const result = socialLinksSchema.safeParse([
      { platform: "twitter", url: "javascript:alert(document.cookie)" },
    ]);
    expect(result.success).toBe(false);
  });

  it("accepts an http:// URL", () => {
    const result = socialLinksSchema.safeParse([
      { platform: "site", url: "http://example.com" },
    ]);
    expect(result.success).toBe(true);
  });
});
