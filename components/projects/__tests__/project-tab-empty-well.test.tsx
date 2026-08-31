// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BoxIcon } from "lucide-react";
import { ProjectTabEmptyWell } from "../project-tab-empty-well";

describe("ProjectTabEmptyWell", () => {
  it("renders preceding icon, tagline, and concise description as a button", () => {
    const onClick = vi.fn();
    render(
      <ProjectTabEmptyWell
        icon={<BoxIcon data-testid="well-icon" className="size-4" />}
        title="Add files"
        description="Bundle the printable parts for this project."
        onClick={onClick}
      />
    );

    expect(screen.getByTestId("well-icon")).toBeTruthy();
    const button = screen.getByRole("button", { name: /add files/i });
    expect(button.className).toMatch(/rounded-2xl/);
    expect(button.className).toMatch(/min-h-\[7\.5rem\]/);
    expect(button.className).toMatch(/border-dashed/);
    expect(
      screen.getByText("Bundle the printable parts for this project.")
    ).toBeTruthy();

    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders as a link when href is provided", () => {
    render(
      <ProjectTabEmptyWell
        href="/projects/demo/build-guide/edit"
        icon={<BoxIcon className="size-4" />}
        title="Write guide"
        description="Steps, photos, and notes for builders."
      />
    );

    const link = screen.getByRole("link", { name: /write guide/i });
    expect(link.getAttribute("href")).toBe(
      "/projects/demo/build-guide/edit"
    );
    expect(link.className).toMatch(/rounded-2xl/);
  });
});
