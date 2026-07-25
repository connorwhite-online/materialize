import { describe, it, expect } from "vitest";
import { resolveProjectVisibility } from "../access";

// MTR-237: pins the visibility decision the project detail page makes
// before rendering — public+published stays open to everyone, every
// other combination requires canWrite (owner / org member / per-
// project collaborator, all folded into that one flag upstream via
// canWriteProject).

describe("resolveProjectVisibility", () => {
  it("is visible for an anonymous viewer on a public published project", () => {
    expect(
      resolveProjectVisibility({
        status: "published",
        visibility: "public",
        canWrite: false,
      })
    ).toBe(true);
  });

  it("is NOT visible for a non-collaborator on a private project (404 path)", () => {
    expect(
      resolveProjectVisibility({
        status: "draft",
        visibility: "private",
        canWrite: false,
      })
    ).toBe(false);
  });

  it("is visible for a collaborator on a private project", () => {
    expect(
      resolveProjectVisibility({
        status: "draft",
        visibility: "private",
        canWrite: true,
      })
    ).toBe(true);
  });

  it("is visible for a collaborator on an unpublished-but-public project", () => {
    expect(
      resolveProjectVisibility({
        status: "draft",
        visibility: "public",
        canWrite: true,
      })
    ).toBe(true);
  });

  it("is NOT visible for an anonymous viewer on a published-but-private project", () => {
    expect(
      resolveProjectVisibility({
        status: "published",
        visibility: "private",
        canWrite: false,
      })
    ).toBe(false);
  });
});
