// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileThumbnailStack } from "@/components/projects/file-thumbnail-stack";

describe("FileThumbnailStack", () => {
  it("renders nothing when there are no thumbnails", () => {
    const { container } = render(<FileThumbnailStack thumbnails={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("sizes each tile at three-quarters of the well (CON-20)", () => {
    const { container } = render(
      <FileThumbnailStack
        thumbnails={["/a.webp", "/b.webp", "/c.webp"]}
      />
    );
    const tiles = container.querySelectorAll(".w-3\\/4");
    expect(tiles.length).toBe(3);
    // Regression guard: the old size must not sneak back in.
    expect(container.querySelectorAll(".w-3\\/5").length).toBe(0);
  });
});
