// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  OrganizationCreateForm,
  MAX_LOGO_BYTES,
  clerkErrorMessage,
} from "../organization-create-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const setLogo = vi.fn().mockResolvedValue(undefined);
const createOrganization = vi.fn();
const setActive = vi.fn().mockResolvedValue(undefined);
vi.mock("@clerk/nextjs", () => ({
  useOrganizationList: () => ({ isLoaded: true, createOrganization, setActive }),
}));

const suggestOrganizationSlug = vi.fn();
const finishOrganizationCreate = vi.fn();
vi.mock("@/app/actions/organizations", () => ({
  suggestOrganizationSlug: (...a: unknown[]) => suggestOrganizationSlug(...a),
  finishOrganizationCreate: (...a: unknown[]) => finishOrganizationCreate(...a),
}));

// jsdom's Blob has no arrayBuffer(); the form copies the picked file with it.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(this);
    });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createOrganization.mockResolvedValue({ id: "org_1", slug: "pneuma", setLogo });
  suggestOrganizationSlug.mockResolvedValue({ slug: "pneuma" });
  finishOrganizationCreate.mockResolvedValue({ slug: "pneuma" });
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
});

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Create organization" }));

describe("OrganizationCreateForm", () => {
  it("renders our own fields, not Clerk's widget", () => {
    render(<OrganizationCreateForm />);
    expect(screen.getByRole("heading", { name: "Organization details" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload logo" })).toBeTruthy();
    expect(screen.queryByText(/Secured by/)).toBeNull();
  });

  it("creates the org, activates it and lands on its handle", async () => {
    render(<OrganizationCreateForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Pneuma  " } });
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pneuma"));
    expect(suggestOrganizationSlug).toHaveBeenCalledWith("Pneuma");
    expect(createOrganization).toHaveBeenCalledWith({ name: "Pneuma", slug: "pneuma" });
    expect(setActive).toHaveBeenCalledWith({ organization: "org_1" });
    expect(finishOrganizationCreate).toHaveBeenCalledWith("org_1");
    expect(setLogo).not.toHaveBeenCalled();
  });

  it("retries without a slug when Clerk has organization slugs turned off", async () => {
    createOrganization.mockRejectedValueOnce({
      errors: [{ code: "organization_slugs_disabled", longMessage: "This instance does not have slugs enabled for organizations." }],
    });
    render(<OrganizationCreateForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pneuma" } });
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pneuma"));
    expect(createOrganization).toHaveBeenLastCalledWith({ name: "Pneuma" });
  });

  it("keeps the typed name when creation fails", async () => {
    createOrganization.mockRejectedValueOnce({ errors: [{ longMessage: "Nope." }] });
    render(<OrganizationCreateForm />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Pneuma" } });
    submit();
    await screen.findByRole("alert");
    expect(input.value).toBe("Pneuma");
  });

  it("lands on the mirrored slug when it differs from Clerk's", async () => {
    finishOrganizationCreate.mockResolvedValueOnce({ slug: "pneuma-2" });
    render(<OrganizationCreateForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pneuma" } });
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pneuma-2"));
  });

  it("falls back to Clerk's slug if mirroring fails", async () => {
    finishOrganizationCreate.mockResolvedValueOnce({ error: "nope" });
    render(<OrganizationCreateForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pneuma" } });
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pneuma"));
  });

  it("stops before Clerk when the name has no usable characters", async () => {
    suggestOrganizationSlug.mockResolvedValueOnce({ error: "Use at least one letter or number in the name." });
    render(<OrganizationCreateForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "!!!" } });
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/letter or number/);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("uploads the chosen logo after the org exists", async () => {
    render(<OrganizationCreateForm />);
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("org-logo-input"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pneuma" } });
    submit();
    await waitFor(() => expect(push).toHaveBeenCalled());
    const sent = setLogo.mock.calls[0][0].file as File;
    expect(sent.name).toBe("logo.png");
    expect(sent.type).toBe("image/png");
  });

  it("still finishes when the logo upload fails", async () => {
    setLogo.mockRejectedValueOnce(new Error("upload failed"));
    render(<OrganizationCreateForm />);
    const file = new File(["x"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("org-logo-input"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pneuma" } });
    submit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/pneuma"));
  });

  it("rejects a logo over Clerk's 10 MB cap before submitting", () => {
    render(<OrganizationCreateForm />);
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: MAX_LOGO_BYTES + 1 });
    fireEvent.change(screen.getByTestId("org-logo-input"), { target: { files: [big] } });
    expect(screen.getByRole("alert").textContent).toMatch(/over 10 MB/);
  });

  it("shows Clerk's message when creation fails, and stays on the page", async () => {
    createOrganization.mockRejectedValueOnce({
      errors: [{ longMessage: "You have reached your limit of organizations." }],
    });
    render(<OrganizationCreateForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pneuma" } });
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You have reached your limit of organizations."
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe("clerkErrorMessage", () => {
  it("falls back to a generic line for non-Clerk errors", () => {
    expect(clerkErrorMessage(new Error("boom"))).toMatch(/Couldn't create/);
  });
});
