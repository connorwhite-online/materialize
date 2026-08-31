// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FileCard,
  FileCardPriceBadge,
  FileCardCreator,
  FileCardDownloads,
  fileCardPhotoUrls,
  formatFileDimensions,
  formatFileExtension,
  formatFileSize,
  fileCardOwnedSubtitle,
  fileCardPurchasedSubtitle,
  FILE_CARD_SHELL_CLASS,
} from "../file-card";

describe("fileCardPhotoUrls", () => {
  it("returns an empty list when there is no cover", () => {
    expect(fileCardPhotoUrls("f1", null, ["p1"])).toEqual([]);
  });

  it("leads with the cover, then curator photo proxy URLs", () => {
    expect(fileCardPhotoUrls("f1", "/api/thumbnails/f1", ["p1", "p2"])).toEqual([
      "/api/thumbnails/f1",
      "/api/thumbnails/f1?photoId=p1",
      "/api/thumbnails/f1?photoId=p2",
    ]);
  });
});

describe("formatFileDimensions", () => {
  it("formats the bounding box for print-adjacent detail", () => {
    expect(formatFileDimensions([40, 30, 20])).toBe("40.0 × 30.0 × 20.0 mm");
  });

  it("returns null when dimensions are missing", () => {
    expect(formatFileDimensions(null)).toBeNull();
    expect(formatFileDimensions(undefined)).toBeNull();
  });
});

describe("file card subtitle helpers", () => {
  it("normalizes format to a lowercase extension", () => {
    expect(formatFileExtension("STL")).toBe(".stl");
    expect(formatFileExtension(".3MF")).toBe(".3mf");
    expect(formatFileExtension(null)).toBeNull();
  });

  it("formats owned subtitle as human-readable file size", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(340 * 1024)).toBe("340.0 KB");
    expect(formatFileSize(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
    expect(fileCardOwnedSubtitle(2048)).toBe("2.0 KB");
    expect(fileCardOwnedSubtitle(null)).toBeNull();
    expect(fileCardOwnedSubtitle(0)).toBeNull();
    expect(fileCardOwnedSubtitle(-1)).toBeNull();
  });

  it("names the seller on purchased cards", () => {
    expect(fileCardPurchasedSubtitle("Ada", "ada")).toBe("by Ada");
    expect(fileCardPurchasedSubtitle(null, "ada")).toBe("by ada");
    expect(fileCardPurchasedSubtitle(null, null)).toBeNull();
  });
});

describe("FileCardPriceBadge", () => {
  it("hides a free listing", () => {
    const { container } = render(<FileCardPriceBadge priceCents={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("prints dollars from cents", () => {
    render(<FileCardPriceBadge priceCents={1250} />);
    expect(screen.getByText("$12.50")).toBeTruthy();
  });
});

describe("FileCard", () => {
  it("renders a link tile with the discover title treatment", () => {
    render(<FileCard href="/files/dragon" title="Articulated dragon" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/files/dragon");
    expect(screen.getByRole("heading", { name: "Articulated dragon" })).toBeTruthy();
    expect(link.querySelector("[data-slot='file-card']")).toBeTruthy();
  });

  it("renders a pressed picker button when selected", () => {
    render(
      <FileCard title="Knight" selected onClick={() => {}} placeholder="No preview" />
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.querySelector("[data-selected='true']")).toBeTruthy();
    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("No preview")).toBeTruthy();
  });

  it("fires onClick for picker tiles", () => {
    const onClick = vi.fn();
    render(<FileCard title="Rook" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the discover shell/well classes on the card", () => {
    const { container } = render(<FileCard title="Bishop" href="/files/bishop" />);
    const card = container.querySelector("[data-slot='file-card']");
    expect(card?.className).toContain(FILE_CARD_SHELL_CLASS);
    expect(card?.firstElementChild?.className).toContain(
      "aspect-square overflow-hidden rounded-lg border border-border"
    );
    expect(card?.firstElementChild?.className).toContain(
      "bg-gradient-to-br from-muted to-muted/50"
    );
  });

  it("uses the compact title scale and w-28 shell for carousel tiles", () => {
    render(
      <FileCard
        compact
        href="/print/asset-1"
        title="Caribiner Hook"
        subtitle="1.2 MB"
      />
    );
    const link = screen.getByRole("link");
    expect(link.className).toContain("w-28");
    const title = screen.getByRole("heading", { name: "Caribiner Hook" });
    expect(title.className).toContain("text-xs");
    expect(screen.getByText("1.2 MB")).toBeTruthy();
  });
});

describe("FileCardCreator / FileCardDownloads", () => {
  it("falls back to a gradient avatar and the display name", () => {
    render(<FileCardCreator username="ada" displayName="Ada" />);
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  it("exposes a compact download count", () => {
    render(<FileCardDownloads count={1500} />);
    expect(screen.getByLabelText("1500 downloads")).toBeTruthy();
    expect(screen.getByText("1.5k")).toBeTruthy();
  });
});
