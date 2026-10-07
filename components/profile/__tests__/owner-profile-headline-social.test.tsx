// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  OwnerProfileHeadline,
  SocialLinksEditor,
} from "@/components/profile/owner-profile-headline";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/profile", () => ({
  updateAvatar: vi.fn(),
  updateProfile: vi.fn(),
  updateSocialLinks: vi.fn(),
}));

describe("SocialLinksEditor", () => {
  it("renders one labelled settings row per platform", () => {
    render(<SocialLinksEditor initial={[]} />);

    // Each input is labelled by its row title (label htmlFor → input id).
    expect(screen.getByLabelText("Website")).toBeTruthy();
    expect(screen.getByLabelText("X / Twitter")).toBeTruthy();
    expect(screen.getByLabelText("GitHub")).toBeTruthy();
    expect(screen.getByLabelText("Instagram")).toBeTruthy();
    expect(screen.getByLabelText("YouTube")).toBeTruthy();

    const rows = document.querySelectorAll('[data-slot="settings-row"]');
    expect(rows.length).toBe(5);
    // Platform glyph beside each label.
    expect(document.querySelectorAll("svg").length).toBeGreaterThanOrEqual(5);
  });

  it("prefills saved links", () => {
    render(
      <SocialLinksEditor
        initial={[{ platform: "github", url: "https://github.com/ada" }]}
      />
    );
    expect(
      (screen.getByLabelText("GitHub") as HTMLInputElement).value
    ).toBe("https://github.com/ada");
  });
});

describe("OwnerProfileHeadline", () => {
  it("is a profile header, not a form: no link inputs under it", () => {
    render(
      <OwnerProfileHeadline
        username="connor"
        displayName=""
        bio="having fun"
        avatarUrl={null}
      />
    );
    expect(screen.getByRole("button", { name: "Change photo" })).toBeTruthy();
    expect(screen.getByText("having fun")).toBeTruthy();
    expect(screen.queryByLabelText("Website")).toBeNull();
  });
});
