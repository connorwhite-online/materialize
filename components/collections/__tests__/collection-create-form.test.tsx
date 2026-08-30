// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CollectionCreateForm } from "../collection-create-form";

vi.mock("@/app/actions/collections", () => ({
  createCollection: vi.fn(),
}));

vi.mock("@/components/orgs/owner-picker", () => ({
  OwnerPicker: () => <input type="hidden" name="organizationId" value="" />,
}));

describe("CollectionCreateForm", () => {
  it("renders the page-form fields, not a dialog", () => {
    render(<CollectionCreateForm />);

    expect(screen.getByText("Collection details")).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByLabelText("Visibility")).toBeTruthy();
    expect(screen.getByLabelText("Category")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create collection" })
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
