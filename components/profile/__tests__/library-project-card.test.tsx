// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  LibraryProjectCard,
  type LibraryProjectCardItem,
} from "@/components/profile/library-project-card";

function project(
  overrides: Partial<LibraryProjectCardItem> = {}
): LibraryProjectCardItem {
  return {
    id: "p1",
    name: "ESP32 Case",
    slug: "esp32-case",
    price: 0,
    visibility: "private",
    source: "owned",
    thumbnailUrl: null,
    coverPhotoId: null,
    fileCount: 2,
    additionalPhotoIds: [],
    fileThumbnails: ["/a.webp", "/b.webp"],
    ...overrides,
  };
}

describe("LibraryProjectCard", () => {
  it("shows an icon-only Private mark above the stack (CON-20)", () => {
    const { container } = render(<LibraryProjectCard item={project()} />);
    const mark = screen.getByLabelText("Private");
    expect(mark).toBeTruthy();
    // Overlay must stack above FileThumbnailStack's z-indexed tiles.
    expect(mark.parentElement?.className).toMatch(/\bz-10\b/);
    expect(container.querySelectorAll(".w-3\\/4").length).toBeGreaterThan(0);
  });

  it("omits the Private mark for purchased projects", () => {
    render(
      <LibraryProjectCard
        item={project({ source: "purchased", visibility: "private" })}
      />
    );
    expect(screen.queryByLabelText("Private")).toBeNull();
  });
});
