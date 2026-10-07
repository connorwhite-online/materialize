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

    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    // Visibility is a pair of radio cards, not a select.
    expect(screen.getByRole("group", { name: "Visibility" })).toBeTruthy();
    expect(
      (screen.getByRole("radio", { name: /Public/ }) as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(screen.getByRole("radio", { name: /Private/ })).toBeTruthy();
    expect(
      screen.getByText(/create the project now and add files to it later/i)
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
