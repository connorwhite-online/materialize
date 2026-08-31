// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LibraryTile } from "@/lib/print/library-tiles";

vi.mock("@/lib/dashboard/pending-orders", () => ({
  loadPendingOrders: vi.fn(),
}));
vi.mock("@/lib/print/library-tiles", () => ({
  loadLibraryTiles: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
}));
vi.mock("@/components/profile/library-tab", () => ({
  LibraryTab: () => <div data-testid="library-tab" />,
}));
vi.mock("@/components/home/home-dropzone", () => ({
  HomeDropzone: () => <div>Add a File</div>,
}));
vi.mock("@/components/home/feathered-carousel", () => ({
  FeatheredCarousel: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
}));

import { loadPendingOrders } from "@/lib/dashboard/pending-orders";
import { loadLibraryTiles } from "@/lib/print/library-tiles";
import { HomeDashboard } from "../home-dashboard";

const tile: LibraryTile = {
  fileAssetId: "asset-hook",
  name: "Caribiner Hook",
  slug: "caribiner-hook",
  thumbnailUrl: null,
  format: "stl",
  source: "owned",
};

describe("HomeDashboard recent file destinations", () => {
  beforeEach(() => {
    vi.mocked(loadPendingOrders).mockResolvedValue([]);
    vi.mocked(loadLibraryTiles).mockResolvedValue([tile]);
  });

  it("links Recent cards to /files/{slug}, not /print/{fileAssetId}", async () => {
    render(await HomeDashboard({ userId: "user-1" }));

    expect(
      screen.getByRole("heading", { name: "Recent files" })
    ).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/files/caribiner-hook");
    expect(link.getAttribute("href")).not.toMatch(/^\/print\//);
    expect(screen.getByRole("heading", { name: "Caribiner Hook" })).toBeTruthy();
  });
});
