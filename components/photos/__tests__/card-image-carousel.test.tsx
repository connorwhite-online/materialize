// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { CardImageCarousel } from "../card-image-carousel";

const imageProps: Array<Record<string, unknown>> = [];

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    imageProps.push(props);
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img data-testid="mock-image" {...props} />;
  },
}));

describe("CardImageCarousel", () => {
  it("bypasses the optimizer for session-gated thumbnail proxy URLs (CON-23)", () => {
    imageProps.length = 0;
    render(
      <div className="relative h-40 w-40">
        <CardImageCarousel images={["/api/thumbnails/file-1?v=abc"]} />
      </div>
    );
    expect(imageProps).toHaveLength(1);
    expect(imageProps[0].unoptimized).toBe(true);
    expect(imageProps[0].src).toBe("/api/thumbnails/file-1?v=abc");
  });

  it("keeps remote signed gallery URLs optimized", () => {
    imageProps.length = 0;
    const remote =
      "https://bucket.r2.cloudflarestorage.com/photos/cover.webp?X-Amz-Signature=x";
    render(
      <div className="relative h-40 w-40">
        <CardImageCarousel images={[remote]} />
      </div>
    );
    expect(imageProps).toHaveLength(1);
    expect(imageProps[0].unoptimized).toBe(false);
    expect(imageProps[0].src).toBe(remote);
  });

  it("applies the gate per slide in a multi-image carousel", () => {
    imageProps.length = 0;
    const remote = "https://cdn.example.com/gallery-2.jpg";
    render(
      <div className="relative h-40 w-40">
        <CardImageCarousel
          images={["/api/thumbnails/projects/p1", remote]}
          size="lg"
        />
      </div>
    );
    expect(imageProps).toHaveLength(2);
    expect(imageProps[0].unoptimized).toBe(true);
    expect(imageProps[1].unoptimized).toBe(false);
  });
});
