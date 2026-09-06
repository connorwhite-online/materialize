import { describe, it, expect } from "vitest";
import { resolveProjectVisibility } from "../access";

// MTR-237 / CON-38: pins the visibility decision the project detail
// page makes before rendering — published + public + ≥1 file stays
// open to everyone; empty shells, drafts, and private rows require
// canWrite (owner / org member / per-project collaborator).

describe("resolveProjectVisibility", () => {
  it("is visible for an anonymous viewer on a public published project with files", () => {
    expect(
      resolveProjectVisibility({
        status: "published",
        visibility: "public",
        canWrite: false,
        fileCount: 1,
      })
    ).toBe(true);
  });

  it("is NOT visible for an anonymous viewer on an empty public published project", () => {
    expect(
      resolveProjectVisibility({
        status: "published",
        visibility: "public",
        canWrite: false,
        fileCount: 0,
      })
    ).toBe(false);
  });

  it("is visible for the owner on an empty public project", () => {
    expect(
      resolveProjectVisibility({
        status: "published",
        visibility: "public",
        canWrite: true,
        fileCount: 0,
      })
    ).toBe(true);
  });

  it("is NOT visible for a non-collaborator on a private project (404 path)", () => {
    expect(
      resolveProjectVisibility({
        status: "draft",
        visibility: "private",
        canWrite: false,
        fileCount: 1,
      })
    ).toBe(false);
  });

  it("is visible for a collaborator on a private project", () => {
    expect(
      resolveProjectVisibility({
        status: "draft",
        visibility: "private",
        canWrite: true,
        fileCount: 1,
      })
    ).toBe(true);
  });

  it("is visible for a collaborator on an unpublished-but-public project", () => {
    expect(
      resolveProjectVisibility({
        status: "draft",
        visibility: "public",
        canWrite: true,
        fileCount: 1,
      })
    ).toBe(true);
  });

  it("is NOT visible for an anonymous viewer on a published-but-private project", () => {
    expect(
      resolveProjectVisibility({
        status: "published",
        visibility: "private",
        canWrite: false,
        fileCount: 1,
      })
    ).toBe(false);
  });
});
