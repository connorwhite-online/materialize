// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/home/dropzone-primitives-lazy", () => ({
  DropzonePrimitives: () => <div data-testid="dropzone-primitives" />,
}));

import { FileUploader } from "../file-uploader";

describe("FileUploader", () => {
  it("uses the featured Add a File well by default", () => {
    const { container } = render(
      <FileUploader onFileSelected={() => {}} />
    );
    const title = screen.getByText("Add a File");
    expect(title).toBeTruthy();
    expect(title.className).toMatch(/bg-card/);
    expect(title.className).toMatch(/border-border/);
    expect(title.className).toMatch(/rounded-full/);
    expect(title.className).not.toMatch(/blue-/);
    expect(screen.getByTestId("dropzone-primitives")).toBeTruthy();
    expect(
      screen.queryByText("STL, OBJ, 3MF, STEP, AMF — Max 200MB")
    ).toBeNull();
    expect(screen.queryByText("Drag and drop or click to upload")).toBeNull();
    expect(container.querySelector(".glass")).toBeNull();
  });

  it("keeps a compact variant without the material backdrop", () => {
    render(
      <FileUploader featured={false} onFileSelected={() => {}} />
    );
    expect(screen.getByText("Drag and drop or click to upload")).toBeTruthy();
    expect(
      screen.getByText("STL, OBJ, 3MF, STEP, AMF — Max 200MB")
    ).toBeTruthy();
    expect(screen.queryByTestId("dropzone-primitives")).toBeNull();
  });

  it("rejects an oversized file", () => {
    render(<FileUploader onFileSelected={() => {}} />);
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    const file = new File([new Uint8Array(8)], "huge.stl", {
      type: "model/stl",
    });
    Object.defineProperty(file, "size", { value: 201 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole("alert").textContent).toMatch(/200MB/);
  });
});
