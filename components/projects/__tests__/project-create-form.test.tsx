// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectCreateForm } from "../project-create-form";

vi.mock("@/app/actions/projects", () => ({
  createProject: vi.fn(),
}));

vi.mock("@/components/orgs/owner-picker", () => ({
  OwnerPicker: () => <input type="hidden" name="organizationId" value="" />,
}));

describe("ProjectCreateForm", () => {
  it("exposes visibility and does not require files to submit", () => {
    render(<ProjectCreateForm ownedFiles={[]} />);

    expect(screen.getByText("Project details")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Visibility")).toBeTruthy();
    expect(
      screen.getByText(/create the project now and add files after/i)
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create project" })
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });
});
