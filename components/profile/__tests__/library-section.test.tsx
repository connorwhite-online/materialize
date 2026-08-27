// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LayersIcon } from "lucide-react";
import { LibrarySection } from "../library-section";

describe("LibrarySection count chip", () => {
  it("shows just the number next to a named section", () => {
    render(
      <LibrarySection
        name="Projects"
        count={6}
        countNoun="Project"
        icon={<LayersIcon />}
      >
        <div>tiles</div>
      </LibrarySection>
    );

    const chip = screen.getByLabelText("6 Projects");
    expect(chip.textContent).toBe("6");
    expect(chip.textContent).not.toMatch(/project/i);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeTruthy();
  });

  it("singular accessible label still uses the noun", () => {
    render(
      <LibrarySection
        name="Files"
        count={1}
        countNoun="File"
        icon={<LayersIcon />}
      >
        <div />
      </LibrarySection>
    );
    expect(screen.getByLabelText("1 File").textContent).toBe("1");
  });

  it("empty libraries keep an Empty chip", () => {
    render(
      <LibrarySection
        name="Projects"
        count={0}
        countNoun="Project"
        icon={<LayersIcon />}
      >
        <div />
      </LibrarySection>
    );
    expect(screen.getByLabelText("Empty projects").textContent).toBe("Empty");
  });
});
