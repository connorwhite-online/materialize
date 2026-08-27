// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FileUploader } from "../file-uploader";

describe("FileUploader", () => {
  it("uses the compact print-flow copy by default", () => {
    render(<FileUploader onFileSelected={() => {}} />);
    expect(screen.getByText("Drag and drop or click to upload")).toBeTruthy();
    expect(screen.getByText("STL, OBJ, 3MF, STEP, AMF — Max 200MB")).toBeTruthy();
  });

  it("accepts featured home copy without a plate or subtext", () => {
    const { container } = render(
      <FileUploader
        featured
        title="Add a File"
        onFileSelected={() => {}}
      />
    );
    expect(screen.getByText("Add a File")).toBeTruthy();
    expect(screen.getByText("Add a File").className).toMatch(/font-semibold/);
    expect(
      screen.queryByText("click here or drag in a file (max 200mb)")
    ).toBeNull();
    expect(screen.queryByText("Drag and drop or click to upload")).toBeNull();
    expect(container.querySelector(".glass")).toBeNull();
    expect(container.innerHTML).not.toMatch(/radial-gradient\(ellipse_at_center/);
  });

  it("rejects an oversized file", () => {
    render(<FileUploader onFileSelected={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(8)], "huge.stl", {
      type: "model/stl",
    });
    Object.defineProperty(file, "size", { value: 201 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole("alert").textContent).toMatch(/200MB/);
  });
});
