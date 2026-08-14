// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HomeFaq } from "../home-faq";
import { HOME_FAQ } from "@/lib/seo/home-faq";

describe("HomeFaq", () => {
  it("renders every question and keeps every answer in the DOM", () => {
    render(<HomeFaq />);
    for (const item of HOME_FAQ) {
      expect(screen.getByText(item.question)).toBeTruthy();
      expect(screen.getByText(item.answer)).toBeTruthy();
    }
    expect(document.querySelectorAll("details")).toHaveLength(HOME_FAQ.length);
  });

  it("opens from the question and closes from a click on the answer", () => {
    render(<HomeFaq />);
    const card = document.querySelector("details") as HTMLDetailsElement;
    const answer = card.querySelector("p") as HTMLElement;
    expect(card.open).toBe(false);

    fireEvent.click(card.querySelector("summary")!);
    expect(card.open).toBe(true);

    fireEvent.click(answer);
    expect(card.open).toBe(false);
  });
});
