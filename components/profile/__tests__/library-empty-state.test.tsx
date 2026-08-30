// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LibraryEmptyState } from "../library-empty-state";

vi.mock("@/components/upload/upload-dialog", () => ({
  UploadDialog: () => null,
}));

describe("LibraryEmptyState", () => {
  it("sends Project and Collection to their create pages", () => {
    render(<LibraryEmptyState />);

    expect(screen.getByRole("link", { name: /start a project/i }).getAttribute("href")).toBe(
      "/projects/new"
    );
    expect(
      screen.getByRole("link", { name: /new collection/i }).getAttribute("href")
    ).toBe("/collections/new");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
