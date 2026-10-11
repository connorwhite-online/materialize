// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SaveToCollection } from "../save-to-collection";

const listSaveOptions = vi.fn();
const setCollectionSaved = vi.fn();
const createCollectionWithItem = vi.fn();
vi.mock("@/app/actions/collection-saves", () => ({
  listSaveOptions: (...a: unknown[]) => listSaveOptions(...a),
  setCollectionSaved: (...a: unknown[]) => setCollectionSaved(...a),
  createCollectionWithItem: (...a: unknown[]) => createCollectionWithItem(...a),
}));

const target = { kind: "file" as const, id: "file_1" };
const desk = { id: "col_1", name: "Desk toys", slug: "desk-toys", organizationId: null };

beforeEach(() => {
  vi.clearAllMocks();
  listSaveOptions.mockResolvedValue({
    collections: [{ ...desk, saved: false }],
  });
  setCollectionSaved.mockImplementation(async (_c, _t, saved) => ({ saved }));
});

const renderSave = (initiallySaved = false) =>
  render(
    <SaveToCollection
      target={target}
      initiallySaved={initiallySaved}
      signedIn
      returnTo="/files/gear"
    />
  );

describe("SaveToCollection", () => {
  it("sends signed-out viewers to sign in and back", () => {
    render(
      <SaveToCollection
        target={target}
        initiallySaved={false}
        signedIn={false}
        returnTo="/files/gear"
      />
    );
    // Our Button keeps role="button" when it renders a Link.
    const link = screen.getByRole("button", { name: "Save" });
    expect(link.getAttribute("href")).toBe("/sign-in?redirect_url=%2Ffiles%2Fgear");
  });

  it("shows the saved state the page already knows", () => {
    renderSave(true);
    const button = screen.getByRole("button", { name: "Saved" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("lists collections on open and saves into one", async () => {
    renderSave();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const row = await screen.findByRole("checkbox", { name: "Desk toys" });
    expect(listSaveOptions).toHaveBeenCalledWith(target);
    expect(row.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(row);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Desk toys" }).getAttribute("aria-checked")
      ).toBe("true")
    );
    expect(setCollectionSaved).toHaveBeenCalledWith("col_1", target, true);
    expect(screen.getByRole("button", { name: "Saved" })).toBeTruthy();
  });

  it("unsaves from a collection that holds it", async () => {
    listSaveOptions.mockResolvedValue({ collections: [{ ...desk, saved: true }] });
    renderSave(true);
    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Desk toys" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeTruthy());
    expect(setCollectionSaved).toHaveBeenCalledWith("col_1", target, false);
  });

  it("starts a first collection inline", async () => {
    listSaveOptions.mockResolvedValue({ collections: [] });
    createCollectionWithItem.mockResolvedValue({
      collection: { id: "col_2", name: "Gifts", slug: "gifts-x", organizationId: null, saved: true },
    });
    renderSave();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/No collections yet/);
    fireEvent.change(screen.getByLabelText("New collection name"), {
      target: { value: "Gifts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
    const row = await screen.findByRole("checkbox", { name: "Gifts" });
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(createCollectionWithItem).toHaveBeenCalledWith("Gifts", target);
    expect((screen.getByLabelText("New collection name") as HTMLInputElement).value).toBe("");
  });

  it("shows the error and keeps the row unchanged when saving fails", async () => {
    setCollectionSaved.mockResolvedValueOnce({ error: "Can't save this." });
    renderSave();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Desk toys" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Can't save this.");
    expect(
      screen.getByRole("checkbox", { name: "Desk toys" }).getAttribute("aria-checked")
    ).toBe("false");
  });
});
