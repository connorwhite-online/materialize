// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DiscussionEmptyBanner } from "../discussion-empty-banner";

describe("DiscussionEmptyBanner", () => {
  it("renders the invitation copy and calls onStart when clicked", () => {
    const onStart = vi.fn();
    render(<DiscussionEmptyBanner onStart={onStart} />);

    const button = screen.getByRole("button", {
      name: /start the conversation/i,
    });
    expect(button.className).toMatch(/bg-gradient-to-br/);
    expect(button.className).toMatch(/from-emerald-100/);
    button.click();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("links to sign-in when signed out", () => {
    render(
      <DiscussionEmptyBanner signInHref="/sign-in?redirect=%2Fprojects%2Fdemo" />
    );

    const link = screen.getByRole("link", {
      name: /start the conversation/i,
    });
    expect(link.getAttribute("href")).toBe(
      "/sign-in?redirect=%2Fprojects%2Fdemo"
    );
  });
});
