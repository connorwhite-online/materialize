// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FolderOpenIcon, LayersIcon } from "lucide-react";
import { CreateFormHeader } from "../create-form-header";

describe("CreateFormHeader", () => {
  it("puts the project icon before the New project heading", () => {
    const { container } = render(
      <CreateFormHeader
        icon={<LayersIcon data-testid="project-icon" className="size-7" />}
        title="New project"
        description="Bundle multiple files into a single sellable unit."
      />
    );

    const heading = screen.getByRole("heading", { name: "New project" });
    const icon = screen.getByTestId("project-icon");
    expect(icon.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[aria-hidden='true']")).toBeTruthy();
  });

  it("puts the collection icon before the New collection heading", () => {
    render(
      <CreateFormHeader
        icon={
          <FolderOpenIcon data-testid="collection-icon" className="size-7" />
        }
        title="New collection"
        description="Group related files."
      />
    );

    const heading = screen.getByRole("heading", { name: "New collection" });
    const icon = screen.getByTestId("collection-icon");
    expect(icon.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
