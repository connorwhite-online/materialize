import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB. Mocks accept rest args so they type-check when called via
// the spread-forwarding wrapper inside vi.mock's factory below.
const mockUpdateSet = vi.fn((..._args: unknown[]) => undefined);
const mockUpdateWhere = vi.fn((..._args: unknown[]) => Promise.resolve());

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

// updateProfile now validates the handle + syncs Clerk (CON-76).
vi.mock("@/lib/handles/validate", () => ({
  validateHandle: vi.fn(async () => null),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "test-user-id" })),
  clerkClient: vi.fn(() =>
    Promise.resolve({ users: { updateUser: vi.fn() } })
  ),
}));

import { updateProfile, updateSocialLinks } from "../profile";
import { validateHandle } from "@/lib/handles/validate";

describe("updateProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateHandle).mockResolvedValue(null);
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

  it("lowercases the handle before saving (CON-76)", async () => {
    const formData = new FormData();
    formData.set("username", "TestUser");
    formData.set("displayName", "Test User");
    formData.set("bio", "Hi");

    await updateProfile(formData);

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ username: "testuser" })
    );
  });

  it("returns an error when the handle is taken/reserved (CON-76)", async () => {
    vi.mocked(validateHandle).mockResolvedValueOnce("That username is taken");
    const formData = new FormData();
    formData.set("username", "taken");
    formData.set("displayName", "Test User");
    formData.set("bio", "Hi");

    const result = await updateProfile(formData);

    expect(result).toMatchObject({ error: { username: ["That username is taken"] } });
    expect(mockUpdateSet).not.toHaveBeenCalled();
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
