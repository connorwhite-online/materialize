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

    expect(screen.getByLabelText("Name")).toBeTruthy();
    // "Optional" sits inside the label beside the field name.
    expect(screen.getByLabelText(/^Description/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Visibility" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Private/ })).toBeTruthy();
    expect(screen.getByLabelText("Category")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create collection" })
    ).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
