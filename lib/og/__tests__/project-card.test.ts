import { describe, it, expect } from "vitest";
import {
  chooseProjectCard,
  MAX_STACK_TILES,
  type ProjectCardFile,
} from "../project-card";

const file = (
  thumbnailUrl: string | null,
  hasCoverPhoto = false
): ProjectCardFile => ({ thumbnailUrl, hasCoverPhoto });

describe("chooseProjectCard", () => {
  it("prefers the project's own cover art over anything derived", () => {
    const choice = chooseProjectCard({
      coverImageUrl: "https://r2.example.com/cover.jpg",
      files: [file("/api/thumbnails/a"), file("/api/thumbnails/b")],
    });
    expect(choice).toEqual({
      kind: "cover",
      imageUrl: "https://r2.example.com/cover.jpg",
    });
  });

  it("gives a lone file the whole frame rather than a stack of one", () => {
    const choice = chooseProjectCard({
      coverImageUrl: null,
      files: [file("/api/thumbnails/a")],
    });
    expect(choice).toEqual({
      kind: "single",
      imageUrl: "/api/thumbnails/a",
      fit: "contain",
    });
  });

  it("fills the frame for a lone file whose art is a photo", () => {
    // A curator photo is a photograph and should fill; the auto
    // capture is a transparent square render that cropping would clip.
    const choice = chooseProjectCard({
      coverImageUrl: null,
      files: [file("/api/thumbnails/a", true)],
    });
    expect(choice).toMatchObject({ kind: "single", fit: "cover" });
  });

  it("fans two or more files into a stack", () => {
    const choice = chooseProjectCard({
      coverImageUrl: null,
      files: [file("/api/thumbnails/a"), file("/api/thumbnails/b")],
    });
    expect(choice).toEqual({
      kind: "stack",
      imageUrls: ["/api/thumbnails/a", "/api/thumbnails/b"],
    });
  });

  it("caps the stack", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      file(`/api/thumbnails/${i}`)
    );
    const choice = chooseProjectCard({ coverImageUrl: null, files: many });
    expect(choice.kind).toBe("stack");
    if (choice.kind !== "stack") throw new Error("unreachable");
    expect(choice.imageUrls).toHaveLength(MAX_STACK_TILES);
    // Display order preserved — the cap takes the first N, not a slice
    // from anywhere else.
    expect(choice.imageUrls[0]).toBe("/api/thumbnails/0");
  });

  it("ignores files that never got a thumbnail", () => {
    const choice = chooseProjectCard({
      coverImageUrl: null,
      files: [file(null), file("/api/thumbnails/b"), file(null)],
    });
    // One usable file among three — still a single, not a stack.
    expect(choice).toMatchObject({ kind: "single", imageUrl: "/api/thumbnails/b" });
  });

  it("falls back to the naming card when there is no art at all", () => {
    expect(
      chooseProjectCard({ coverImageUrl: null, files: [] })
    ).toEqual({ kind: "none" });
    expect(
      chooseProjectCard({ coverImageUrl: null, files: [file(null)] })
    ).toEqual({ kind: "none" });
  });

  it("treats an empty cover URL as absent", () => {
    const choice = chooseProjectCard({
      coverImageUrl: "",
      files: [file("/api/thumbnails/a")],
    });
    expect(choice.kind).toBe("single");
  });
});
