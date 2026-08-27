// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

vi.mock("@/components/profile/new-collection-dialog", () => ({
  NewCollectionDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">New collection</div> : null,
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
    expect(
      screen.getByRole("button", { name: /new collection/i })
    ).toBeTruthy();
    expect(screen.getByTestId("dropzone-primitives")).toBeTruthy();
  });

  it("opens the new collection dialog", () => {
    render(<HomeDropzone />);
    fireEvent.click(screen.getByRole("button", { name: /new collection/i }));
    expect(screen.getByRole("dialog").textContent).toMatch(/new collection/i);
  });
});
