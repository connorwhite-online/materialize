import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn(() => Promise.resolve());

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (...args: unknown[]) => {
        mockUpdateSet(...args);
        return {
          where: (...w: unknown[]) => {
            mockUpdateWhere(...w);
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: { id: "id" },
}));

import { updateProfile, updateSocialLinks } from "../profile";

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates profile with valid data", async () => {
    const formData = new FormData();
    formData.set("username", "testuser");
    formData.set("displayName", "Test User");
    formData.set("bio", "Hello world");

    await updateProfile(formData);

    expect(mockUpdateSet).toHaveBeenCalledWith({
      username: "testuser",
      displayName: "Test User",
      bio: "Hello world",
    });
  });

  it("returns error for invalid username", async () => {
    const formData = new FormData();
    formData.set("username", "ab"); // too short

    const result = await updateProfile(formData);
    expect(result).toHaveProperty("error");
  });

  it("returns error for username with special chars", async () => {
    const formData = new FormData();
    formData.set("username", "test user!");

    const result = await updateProfile(formData);
    expect(result).toHaveProperty("error");
  });
});

describe("updateSocialLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates social links with valid data", async () => {
    const links = [
      { platform: "twitter", url: "https://twitter.com/test" },
      { platform: "github", url: "https://github.com/test" },
    ];

    await updateSocialLinks(JSON.stringify(links));

    expect(mockUpdateSet).toHaveBeenCalledWith({ socialLinks: links });
  });

  it("returns error for invalid URL", async () => {
    const links = [{ platform: "twitter", url: "not-a-url" }];

    const result = await updateSocialLinks(JSON.stringify(links));
    expect(result).toHaveProperty("error");
  });

  it("returns error for too many links", async () => {
    const links = Array.from({ length: 7 }, (_, i) => ({
      platform: `platform${i}`,
      url: `https://example.com/${i}`,
    }));

    const result = await updateSocialLinks(JSON.stringify(links));
    expect(result).toHaveProperty("error");
  });
});
