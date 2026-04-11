import { describe, it, expect } from "vitest";
import {
  fileExtensionToFormat,
  createListingSchema,
  profileSchema,
  socialLinksSchema,
  ACCEPTED_FORMATS,
  MAX_FILE_SIZE,
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
    license: "free",
    tags: "tag1, tag2, tag3",
  };

  it("parses valid data", () => {
    const result = createListingSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Test Model");
      expect(result.data.price).toBe(999); // dollars to cents
      expect(result.data.license).toBe("free");
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
    for (const license of ["free", "personal", "commercial"]) {
      const result = createListingSchema.safeParse({ ...validData, license });
      expect(result.success).toBe(true);
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
});
