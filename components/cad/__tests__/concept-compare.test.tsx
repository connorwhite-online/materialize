// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ConceptPreview } from "../concept-compare";

afterEach(cleanup);

const options = [
  { id: "opt-1", label: "Soft pebble", detail: "rounded plan, domed top", thumbnail: "AAA" },
  { id: "opt-2", label: "Stacked discs", detail: "two soft discs", thumbnail: "BBB" },
  { id: "opt-3", label: "No image" },
];

describe("ConceptPreview", () => {
  it("shows the armed option large, and nothing without images", () => {
    render(<ConceptPreview options={options} armedId="opt-2" onArm={() => {}} />);
    const img = screen.getByAltText("Stacked discs") as HTMLImageElement;
    expect(img.src).toContain("BBB");

    cleanup();
    const { container } = render(
      <ConceptPreview options={[{ id: "x", label: "text only" }]} armedId="x" onArm={() => {}} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("enlarges, flips between options, and chooses the one on screen", () => {
    const onArm = vi.fn();
    render(<ConceptPreview options={options} armedId="opt-1" onArm={onArm} />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Soft pebble" }));
    // fullscreen view opens on the armed option, with its description
    expect(screen.getByText("rounded plan, domed top")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next option" }));
    expect(screen.getByText("two soft discs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Choose this one" }));
    expect(onArm).toHaveBeenCalledWith("opt-2");
  });
});
