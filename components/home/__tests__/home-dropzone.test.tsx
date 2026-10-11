// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/home/dropzone-primitives-lazy", () => ({
  DropzonePrimitives: () => <div data-testid="dropzone-primitives" />,
}));

vi.mock("@/components/upload/use-start-print-flow", () => ({
  useStartPrintFlow: () => ({
    start: vi.fn(),
    phase: "idle",
    progress: 0,
    error: null,
    isPending: false,
  }),
}));

import { HomeDropzone } from "../home-dropzone";

describe("HomeDropzone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the featured file drop and create actions", () => {
    render(<HomeDropzone />);
    expect(screen.getByText("Add a File")).toBeTruthy();
    expect(
      screen.queryByText("click here or drag in a file (max 200mb)")
    ).toBeNull();
    expect(screen.queryByText("Upload a file")).toBeNull();
    const project = screen.getByRole("button", { name: /new project/i });
    expect(project.getAttribute("href")).toBe("/projects/new");
    // Collections start from the Save button on file and project pages.
    expect(screen.queryByRole("button", { name: /new collection/i })).toBeNull();
    expect(screen.getByTestId("dropzone-primitives")).toBeTruthy();
  });

  it("does not open a collection overlay", () => {
    render(<HomeDropzone />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
