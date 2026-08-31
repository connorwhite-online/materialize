// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OwnerProfileHeadline } from "@/components/profile/owner-profile-headline";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/actions/profile", () => ({
  updateAvatar: vi.fn(),
  updateProfile: vi.fn(),
  updateSocialLinks: vi.fn(),
}));

describe("OwnerProfileHeadline social links", () => {
  it("uses platform icons instead of text labels, left of the inputs", () => {
    render(
      <OwnerProfileHeadline
        username="connor"
        displayName=""
        bio="having fun"
        avatarUrl={null}
        socialLinks={[]}
      />
    );

    // Accessible names come from aria-label on the inputs — not visible text.
    expect(screen.getByLabelText("Website")).toBeTruthy();
    expect(screen.getByLabelText("X / Twitter")).toBeTruthy();
    expect(screen.getByLabelText("GitHub")).toBeTruthy();
    expect(screen.getByLabelText("Instagram")).toBeTruthy();
    expect(screen.getByLabelText("YouTube")).toBeTruthy();

    // No visible text labels for platforms.
    expect(screen.queryByText("Website")).toBeNull();
    expect(screen.queryByText("X / Twitter")).toBeNull();
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.queryByText("Instagram")).toBeNull();
    expect(screen.queryByText("YouTube")).toBeNull();

    // One decorative svg per platform row.
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(5);
  });
});
